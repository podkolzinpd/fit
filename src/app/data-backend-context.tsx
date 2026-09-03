import { createContext, use, useMemo, type PropsWithChildren } from 'react'
import { appFeedbackRepository } from '../data/repositories/app-feedback.repository'
import { clientsRepository } from '../data/repositories/clients.repository'
import { exercisesRepository } from '../data/repositories/exercises.repository'
import { goalsRepository } from '../data/repositories/goals.repository'
import { invitationsRepository } from '../data/repositories/invitations.repository'
import { progressRepository } from '../data/repositories/progress.repository'
import { pushNotificationsRepository } from '../data/repositories/push-notifications.repository'
import { realtimeRepository } from '../data/repositories/realtime.repository'
import { trainingSummariesRepository } from '../data/repositories/training-summaries.repository'
import { workoutsRepository } from '../data/repositories/workouts.repository'
import { createYandexMainRepository } from '../data/repositories/yandex-main.repository'
import { getYandexMainRoutingConfig, isYandexMainRoutingPilotEnabled } from './feature-flags'
import { useAuth } from './auth-context'
import { useYandexAppSession } from './yandex-app-session-context'

export interface DataBackend {
  source: 'supabase' | 'yandex'
  clients: typeof clientsRepository
  exercises: typeof exercisesRepository
  goals: typeof goalsRepository
  invitations: typeof invitationsRepository
  progress: typeof progressRepository
  workouts: typeof workoutsRepository
  trainingSummaries: typeof trainingSummariesRepository
  appFeedback: typeof appFeedbackRepository
  pushNotifications: typeof pushNotificationsRepository
  realtime: typeof realtimeRepository
}

const supabaseDataBackend: DataBackend = {
  source: 'supabase',
  clients: clientsRepository,
  exercises: exercisesRepository,
  goals: goalsRepository,
  invitations: invitationsRepository,
  progress: progressRepository,
  workouts: workoutsRepository,
  trainingSummaries: trainingSummariesRepository,
  appFeedback: appFeedbackRepository,
  pushNotifications: pushNotificationsRepository,
  realtime: realtimeRepository,
}

const DataBackendContext = createContext<DataBackend | null>(null)

export function DataBackendProvider({ children }: PropsWithChildren) {
  const { actor } = useAuth()
  const { session } = useYandexAppSession()
  const config = useMemo(() => getYandexMainRoutingConfig(), [])
  const value = useMemo(() => {
    if (actor === null || session === null || config === null
      || actor.userId !== session.profile.id
      || !isYandexMainRoutingPilotEnabled(actor.userId)) {
      return supabaseDataBackend
    }
    return createYandexMainRepository(config.apiBaseUrl, session.session.token, actor)
  }, [actor, config, session])

  return <DataBackendContext value={value}>{children}</DataBackendContext>
}

export function useDataBackend(): DataBackend {
  // Keeping the Supabase backend as the test/default value preserves existing
  // isolated component harnesses. Production composition always installs the
  // provider and selects once from the authenticated session.
  return use(DataBackendContext) ?? supabaseDataBackend
}
