import { appFeedbackRepository } from '../data/repositories/app-feedback.repository'
import { clientsRepository } from '../data/repositories/clients.repository'
import { chatRepository } from '../data/repositories/chat.repository'
import { exercisesRepository } from '../data/repositories/exercises.repository'
import { favoriteWorkoutsRepository } from '../data/repositories/favorite-workouts.repository'
import { goalsRepository } from '../data/repositories/goals.repository'
import { invitationsRepository } from '../data/repositories/invitations.repository'
import { legalRepository } from '../data/repositories/legal.repository'
import { progressRepository } from '../data/repositories/progress.repository'
import { pushNotificationsRepository } from '../data/repositories/push-notifications.repository'
import { realtimeRepository } from '../data/repositories/realtime.repository'
import { trainingSummariesRepository } from '../data/repositories/training-summaries.repository'
import { trainerProfilesRepository } from '../data/repositories/trainer-profiles.repository'
import { trainerDiscoveryRepository } from '../data/repositories/trainer-discovery.repository'
import { trainerWorkspaceRepository } from '../data/repositories/trainer-workspace.repository'
import { trainerFinanceRepository } from '../data/repositories/trainer-finance.repository'
import { clientFinanceRepository } from '../data/repositories/client-finance.repository'
import { athleteSportProfileRepository } from '../data/repositories/athlete-sport-profile.repository'
import { unsupportedNutritionRepository } from '../data/repositories/nutrition.repository'
import { workoutsRepository } from '../data/repositories/workouts.repository'
import { workoutTemplatesRepository } from '../data/repositories/workout-templates.repository'
import { authRepository } from '../data/repositories/auth.repository'
import { supabaseAssistantBackend } from '../data/repositories/assistant.repository'
import type { DataBackend } from './data-backend-context'

const supabaseDataBackend: DataBackend = {
  source: 'supabase',
  clients: clientsRepository,
  chat: chatRepository,
  exercises: exercisesRepository,
  goals: goalsRepository,
  invitations: invitationsRepository,
  legal: legalRepository,
  progress: progressRepository,
  workouts: workoutsRepository,
  favoriteWorkouts: favoriteWorkoutsRepository,
  workoutTemplates: workoutTemplatesRepository,
  trainingSummaries: trainingSummariesRepository,
  trainerProfiles: trainerProfilesRepository,
  trainerDiscovery: trainerDiscoveryRepository,
  trainerWorkspace: trainerWorkspaceRepository,
  trainerFinance: trainerFinanceRepository,
  clientFinance: clientFinanceRepository,
  athleteSportProfile: athleteSportProfileRepository,
  nutrition: unsupportedNutritionRepository,
  appFeedback: appFeedbackRepository,
  pushNotifications: pushNotificationsRepository,
  realtime: realtimeRepository,
}

export const localLegacyAvailable = true

export function getLocalLegacyComposition() {
  return { auth: authRepository, data: supabaseDataBackend, assistant: supabaseAssistantBackend }
}
