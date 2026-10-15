import { getLocalDataBackend, localLegacyAvailable } from '#fit/local-data'
import { createContext, use, useMemo, type PropsWithChildren } from 'react'
import type { appFeedbackRepository } from '../data/repositories/app-feedback.repository'
import type { clientsRepository } from '../data/repositories/clients.repository'
import type { chatRepository } from '../data/repositories/chat.repository'
import type { exercisesRepository } from '../data/repositories/exercises.repository'
import type { favoriteWorkoutsRepository } from '../data/repositories/favorite-workouts.repository'
import type { goalsRepository } from '../data/repositories/goals.repository'
import type { invitationsRepository } from '../data/repositories/invitations.repository'
import type { legalRepository } from '../data/repositories/legal.repository'
import type { progressRepository } from '../data/repositories/progress.repository'
import type { pushNotificationsRepository } from '../data/repositories/push-notifications.repository'
import type { realtimeRepository } from '../data/repositories/realtime.repository'
import type { trainingSummariesRepository } from '../data/repositories/training-summaries.repository'
import type { trainerProfilesRepository } from '../data/repositories/trainer-profiles.repository'
import type { trainerDiscoveryRepository } from '../data/repositories/trainer-discovery.repository'
import type { trainerWorkspaceRepository } from '../data/repositories/trainer-workspace.repository'
import type { trainerFinanceRepository } from '../data/repositories/trainer-finance.repository'
import type { clientFinanceRepository } from '../data/repositories/client-finance.repository'
import type { athleteSportProfileRepository } from '../data/repositories/athlete-sport-profile.repository'
import type { NutritionRepository } from '../data/repositories/nutrition.repository'
import type { workoutsRepository } from '../data/repositories/workouts.repository'
import type { workoutTemplatesRepository } from '../data/repositories/workout-templates.repository'
import { createYandexMainRepository } from '../data/repositories/yandex-main.repository'
import { getYandexAppSessionEntryConfig, getYandexMainRoutingConfig, isYandexMainRoutingEnabled, isYandexOnlyAuthEnabled } from './feature-flags'
import { useAuth } from './auth-context'
import { useYandexAppSession } from './yandex-app-session-context'

export interface DataBackend {
  source: 'supabase' | 'yandex'
  clients: typeof clientsRepository
  chat: typeof chatRepository
  exercises: typeof exercisesRepository
  goals: typeof goalsRepository
  invitations: typeof invitationsRepository
  legal: typeof legalRepository
  progress: typeof progressRepository
  workouts: typeof workoutsRepository
  favoriteWorkouts: typeof favoriteWorkoutsRepository
  workoutTemplates: typeof workoutTemplatesRepository
  trainingSummaries: typeof trainingSummariesRepository
  trainerProfiles: typeof trainerProfilesRepository
  trainerDiscovery: typeof trainerDiscoveryRepository
  trainerWorkspace: typeof trainerWorkspaceRepository
  trainerFinance: typeof trainerFinanceRepository
  clientFinance: typeof clientFinanceRepository
  athleteSportProfile: typeof athleteSportProfileRepository
  nutrition: NutritionRepository
  appFeedback: typeof appFeedbackRepository
  pushNotifications: typeof pushNotificationsRepository
  realtime: typeof realtimeRepository
}

const DataBackendContext = createContext<DataBackend | 'yandex-session-unavailable' | null>(null)

export function DataBackendProvider({ children }: PropsWithChildren) {
  const { actor } = useAuth()
  const { session } = useYandexAppSession()
  const config = useMemo(
    () => getYandexMainRoutingConfig() ?? getYandexAppSessionEntryConfig(),
    [],
  )
  const value = useMemo(() => {
    if (actor !== null && isYandexOnlyAuthEnabled()
      && (session === null || config === null || actor.userId !== session.profile.id
        || session.accessMode !== 'read_write')) {
      return 'yandex-session-unavailable'
    }
    if (actor === null || session === null || config === null
      || actor.userId !== session.profile.id
      || (!isYandexMainRoutingEnabled() && session.accessMode !== 'read_write')) {
      return localLegacyAvailable ? getLocalDataBackend() : 'yandex-session-unavailable'
    }
    return createYandexMainRepository(config.apiBaseUrl, session.session.token, actor)
  }, [actor, config, session])

  return <DataBackendContext value={value}>{children}</DataBackendContext>
}

export function useDataBackend(): DataBackend {
  const backend = use(DataBackendContext)
  if (backend === 'yandex-session-unavailable') {
    throw new Error('Сессия Yandex ID недоступна. Войдите снова.')
  }
  // Local component harnesses retain their legacy default. Release builds
  // require explicit native composition and cannot select a legacy adapter.
  if (backend !== null) return backend
  if (localLegacyAvailable) return getLocalDataBackend()
  throw new Error('useDataBackend должен использоваться внутри DataBackendProvider')
}
