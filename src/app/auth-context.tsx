import { useQueryClient } from '@tanstack/react-query'
import { createContext, use, useCallback, useMemo, useState, type PropsWithChildren } from 'react'
import type { ScheduleDensity, SessionActor } from '../shared/domain'
import { yandexPilotRepository } from '../data/repositories/yandex-pilot.repository'
import { isYandexMainRoutingEnabled } from './feature-flags'
import { useOptionalYandexAppSession } from './yandex-app-session-context'
import { clearNutritionForms } from '../shared/nutrition-session'

interface AuthState {
  actor: SessionActor | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  updateProfile: (input: { firstName: string | null; lastName: string | null; timezone: string; scheduleDensity?: ScheduleDensity }) => Promise<void>
  updateScheduleDensity: (density: ScheduleDensity) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const yandexSession = useOptionalYandexAppSession()
  const yandexRoutingEnabled = yandexSession?.session != null && isYandexMainRoutingEnabled()
  const [scheduleDensityOverride, setScheduleDensityOverride] = useState<ScheduleDensity | null>(null)
  const yandexActor = useMemo<SessionActor | null>(() => {
    const profile = yandexSession?.session?.profile
    if (profile === undefined || !isYandexMainRoutingEnabled()) return null
    if (profile.accountRole === 'trainer') {
      return {
        kind: 'trainer', role: 'trainer', userId: profile.id, email: null,
        firstName: profile.firstName, lastName: profile.lastName, timezone: profile.timezone,
        experiments: profile.experiments,
        preferences: { scheduleDensity: scheduleDensityOverride ?? profile.preferences?.scheduleDensity ?? 'comfortable' },
      }
    }
    if (profile.client === null || profile.client === undefined) {
      // Новый спортсмен сначала имеет только account profile. Сохраняем тот же
      // pre-card actor contract, что и email-регистрация: роль уже клиентская,
      // а собственная client card появится после явного первого действия.
      return {
        kind: 'trainer', role: 'client', userId: profile.id, email: null,
        firstName: profile.firstName, lastName: profile.lastName, timezone: profile.timezone,
        experiments: profile.experiments,
        preferences: { scheduleDensity: scheduleDensityOverride ?? profile.preferences?.scheduleDensity ?? 'comfortable' },
      }
    }
    return {
      kind: 'client', role: 'client', userId: profile.id, email: null,
      firstName: profile.firstName, lastName: profile.lastName, timezone: profile.timezone,
      experiments: profile.experiments,
      preferences: { scheduleDensity: scheduleDensityOverride ?? profile.preferences?.scheduleDensity ?? 'comfortable' },
      clientId: profile.client.id, trainerId: profile.client.trainerId,
      fullName: profile.client.fullName,
    }
  }, [scheduleDensityOverride, yandexSession?.session])
  const actor = yandexActor
  const loading = yandexSession?.loading ?? false
  const error = yandexActor === null && yandexSession?.session != null
    ? 'Yandex ID профиль не содержит данных выбранной роли.'
    : yandexSession?.error ?? null

  const refresh = useCallback(async () => {
    if (yandexSession === null) throw new Error('Yandex ID сессия недоступна')
    await yandexSession.retry()
  }, [yandexSession])

  const signOut = useCallback(async () => {
    if (yandexSession === null) throw new Error('Yandex ID сессия недоступна')
    await yandexSession.signOut()
    queryClient.clear()
    clearNutritionForms()
  }, [queryClient, yandexSession])

  const updateProfile = useCallback(async (input: { firstName: string | null; lastName: string | null; timezone: string; scheduleDensity?: ScheduleDensity }) => {
    if (!yandexRoutingEnabled || yandexSession?.session == null) throw new Error('Профиль тренера недоступен')
    const config = String(import.meta.env.VITE_YANDEX_API_BASE_URL ?? '').trim().replace(/\/$/, '')
    await yandexPilotRepository.updateProfile(config, yandexSession.session.session.token, input)
    await yandexSession.retry()
  }, [yandexRoutingEnabled, yandexSession])

  const updateScheduleDensity = useCallback(async (density: ScheduleDensity) => {
    if (!actor || actor.role !== 'trainer' || !yandexRoutingEnabled || yandexSession?.session == null) throw new Error('Настройка расписания недоступна')
    const config = String(import.meta.env.VITE_YANDEX_API_BASE_URL ?? '').trim().replace(/\/$/, '')
    await yandexPilotRepository.updateProfile(config, yandexSession.session.session.token, {
      firstName: actor.firstName, lastName: actor.lastName, timezone: actor.timezone, scheduleDensity: density,
    })
    setScheduleDensityOverride(density)
  }, [actor, yandexRoutingEnabled, yandexSession])

  const value = useMemo(() => ({ actor, loading, error, refresh, signOut, updateProfile, updateScheduleDensity }), [actor, loading, error, refresh, signOut, updateProfile, updateScheduleDensity])
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const context = use(AuthContext)
  if (!context) throw new Error('useAuth должен использоваться внутри AuthProvider')
  return context
}
