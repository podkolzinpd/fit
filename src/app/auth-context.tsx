import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import type { SessionActor } from '../shared/domain'
import { authRepository } from '../data/repositories/auth.repository'

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
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const [actor, setActor] = useState<SessionActor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const actorRef = useRef<SessionActor | null>(null)
  const initializationRef = useRef<{ userId: string; promise: Promise<SessionActor> } | null>(null)
  const sessionRevisionRef = useRef(0)

  const initializeUser = useCallback((user: AuthUser) => {
    if (actorRef.current?.userId === user.id) return Promise.resolve(actorRef.current)
    if (initializationRef.current?.userId === user.id) return initializationRef.current.promise

    const promise = authRepository.initialize(user).finally(() => {
      if (initializationRef.current?.promise === promise) initializationRef.current = null
    })
    initializationRef.current = { userId: user.id, promise }
    return promise
  }, [])

  const applyUser = useCallback(async (user: AuthUser | null) => {
    const revision = ++sessionRevisionRef.current
    if (!user) {
      actorRef.current = null
      initializationRef.current = null
      setActor(null)
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const initialized = await initializeUser(user)
      if (revision !== sessionRevisionRef.current) return
      actorRef.current = initialized
      setActor(initialized)
      setError(null)
    } catch (caught) {
      if (revision !== sessionRevisionRef.current) return
      actorRef.current = null
      setActor(null)
      setError(caught instanceof Error ? caught.message : 'Ошибка авторизации')
    } finally {
      if (revision === sessionRevisionRef.current) setLoading(false)
    }
  }, [initializeUser])

  const refresh = useCallback(async () => {
    try {
      const result = await authRepository.getSession()
      if (result.error) throw result.error
      const user = result.data.session?.user
      await applyUser(user ? { id: user.id, email: user.email, user_metadata: user.user_metadata } : null)
    } catch (caught) {
      actorRef.current = null
      setActor(null)
      setError(caught instanceof Error ? caught.message : 'Ошибка авторизации')
      setLoading(false)
    }
  }, [applyUser])

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

  const value = useMemo(() => ({ actor, loading, error, refresh }), [actor, loading, error, refresh])
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const context = use(AuthContext)
  if (!context) throw new Error('useAuth должен использоваться внутри AuthProvider')
  return context
}
