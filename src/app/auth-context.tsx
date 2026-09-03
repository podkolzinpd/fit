import { useQueryClient } from '@tanstack/react-query'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import type { SessionActor } from '../shared/domain'
import { authRepository } from '../data/repositories/auth.repository'
import { yandexPilotRepository } from '../data/repositories/yandex-pilot.repository'
import { isYandexMainRoutingPilotEnabled } from './feature-flags'
import { useOptionalYandexAppSession } from './yandex-app-session-context'

interface AuthUser {
  id: string
  email?: string
  user_metadata: Record<string, unknown>
}

interface AuthState {
  actor: SessionActor | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  updateProfile: (input: { firstName: string | null; lastName: string | null; timezone: string }) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const yandexSession = useOptionalYandexAppSession()
  const [supabaseActor, setSupabaseActor] = useState<SessionActor | null>(null)
  const [supabaseLoading, setSupabaseLoading] = useState(true)
  const [supabaseError, setSupabaseError] = useState<string | null>(null)
  const actorRef = useRef<SessionActor | null>(null)
  const initializationRef = useRef<{ userId: string; promise: Promise<SessionActor> } | null>(null)
  const sessionRevisionRef = useRef(0)
  const retiredSupabaseForYandexRef = useRef<string | null>(null)

  const initializeUser = useCallback((user: AuthUser, force = false) => {
    if (!force && actorRef.current?.userId === user.id) return Promise.resolve(actorRef.current)
    if (!force && initializationRef.current?.userId === user.id) return initializationRef.current.promise

    const promise = authRepository.initialize(user).finally(() => {
      if (initializationRef.current?.promise === promise) initializationRef.current = null
    })
    initializationRef.current = { userId: user.id, promise }
    return promise
  }, [])

  const applyUser = useCallback(async (user: AuthUser | null, force = false) => {
    const revision = ++sessionRevisionRef.current
    if (!user) {
      // TanStack Query живёт выше AuthProvider. Без явной очистки следующий
      // пользователь на общем устройстве может увидеть прошлый server state
      // до первого разрешённого refetch.
      queryClient.clear()
      actorRef.current = null
      initializationRef.current = null
      setSupabaseActor(null)
      setSupabaseError(null)
      setSupabaseLoading(false)
      return
    }

    // `force` используется для явного refresh профиля. Очищаем и в этом
    // случае: actor может сменить тип/роль после привязки клиентского аккаунта.
    if (force || actorRef.current?.userId !== user.id) queryClient.clear()
    if (!force) setSupabaseLoading(true)
    try {
      const initialized = await initializeUser(user, force)
      if (revision !== sessionRevisionRef.current) return
      actorRef.current = initialized
      setSupabaseActor(initialized)
      setSupabaseError(null)
    } catch (caught) {
      if (revision !== sessionRevisionRef.current) return
      actorRef.current = null
      setSupabaseActor(null)
      setSupabaseError(caught instanceof Error ? caught.message : 'Ошибка авторизации')
    } finally {
      if (revision === sessionRevisionRef.current && !force) setSupabaseLoading(false)
    }
  }, [initializeUser, queryClient])

  const refreshSupabase = useCallback(async () => {
    try {
      const result = await authRepository.getSession()
      if (result.error) throw result.error
      const user = result.data.session?.user
      await applyUser(user ? { id: user.id, email: user.email, user_metadata: user.user_metadata } : null, true)
    } catch (caught) {
      queryClient.clear()
      actorRef.current = null
      setSupabaseActor(null)
      setSupabaseError(caught instanceof Error ? caught.message : 'Ошибка авторизации')
      setSupabaseLoading(false)
    }
  }, [applyUser, queryClient])

  useEffect(() => {
    const { data } = authRepository.onAuthStateChange((_event, session) => {
      const user = session?.user
      queueMicrotask(() => void applyUser(user ? {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata,
      } : null))
    })
    return () => data.subscription.unsubscribe()
  }, [applyUser])

  const yandexActor = useMemo<SessionActor | null>(() => {
    const profile = yandexSession?.session?.profile
    if (profile === undefined || !isYandexMainRoutingPilotEnabled(profile.id)) return null
    if (profile.accountRole === 'trainer') {
      return {
        kind: 'trainer', role: 'trainer', userId: profile.id, email: null,
        firstName: profile.firstName, lastName: profile.lastName, timezone: profile.timezone,
      }
    }
    if (profile.client === null || profile.client === undefined) return null
    return {
      kind: 'client', role: 'client', userId: profile.id, email: null,
      firstName: profile.firstName, lastName: profile.lastName, timezone: profile.timezone,
      clientId: profile.client.id, trainerId: profile.client.trainerId,
      fullName: profile.client.fullName,
    }
  }, [yandexSession?.session])
  const yandexRoutingEnabled = yandexSession?.session !== null
    && yandexSession?.session !== undefined
    && isYandexMainRoutingPilotEnabled(yandexSession.session.profile.id)
  const actor = yandexRoutingEnabled ? yandexActor : supabaseActor
  const loading = yandexRoutingEnabled
    ? yandexSession.loading
    : Boolean(yandexSession?.loading && import.meta.env.VITE_YANDEX_MAIN_ROUTING_ENABLED === 'true') || supabaseLoading
  const error = yandexRoutingEnabled
    ? yandexActor === null ? 'Yandex ID профиль не содержит данных выбранной роли.' : yandexSession.error
    : supabaseError

  useEffect(() => {
    const token = yandexRoutingEnabled ? yandexSession?.session?.session.token : undefined
    if (token === undefined || retiredSupabaseForYandexRef.current === token) return
    retiredSupabaseForYandexRef.current = token
    // После выбора sticky Yandex backend удаляем старую Supabase-сессию этого
    // браузера: истечение Yandex token не должно молча вернуть пользователя к
    // другому источнику данных.
    void authRepository.signOut().catch(() => {
      actorRef.current = null
      setSupabaseActor(null)
    })
  }, [yandexRoutingEnabled, yandexSession?.session?.session.token])

  const refresh = useCallback(async () => {
    if (yandexRoutingEnabled && yandexSession !== null) {
      await yandexSession.retry()
      return
    }
    await refreshSupabase()
  }, [refreshSupabase, yandexRoutingEnabled, yandexSession])

  const signOut = useCallback(async () => {
    queryClient.clear()
    if (yandexRoutingEnabled && yandexSession !== null) {
      await yandexSession.signOut()
      await authRepository.signOut()
      return
    }
    await authRepository.signOut()
  }, [queryClient, yandexRoutingEnabled, yandexSession])

  const updateProfile = useCallback(async (input: { firstName: string | null; lastName: string | null; timezone: string }) => {
    if (yandexRoutingEnabled && yandexSession?.session !== null && yandexSession?.session !== undefined) {
      const config = String(import.meta.env.VITE_YANDEX_API_BASE_URL ?? '').trim().replace(/\/$/, '')
      await yandexPilotRepository.updateProfile(
        config,
        yandexSession.session.session.token,
        input,
      )
      await yandexSession.retry()
      return
    }
    if (supabaseActor?.kind !== 'trainer') throw new Error('Профиль тренера недоступен')
    await authRepository.updateProfile({ ...supabaseActor, ...input })
  }, [supabaseActor, yandexRoutingEnabled, yandexSession])

  const value = useMemo(() => ({ actor, loading, error, refresh, signOut, updateProfile }), [actor, loading, error, refresh, signOut, updateProfile])
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const context = use(AuthContext)
  if (!context) throw new Error('useAuth должен использоваться внутри AuthProvider')
  return context
}
