import { createYandexMainRepository } from '../data/repositories/yandex-main.repository'

export const nativeBackend = createYandexMainRepository('http://127.0.0.1:4100', 'a'.repeat(43), {
  kind: 'trainer', role: 'trainer', userId: '10000000-0000-4000-8000-000000000001',
  email: null, firstName: 'Trainer', lastName: null, timezone: 'Europe/Moscow',
})

// Unit media fixtures serve their local public assets without HTTP signing.
nativeBackend.exercises.vitalMediaMode = 'public'

export const clientsRepository = nativeBackend.clients
export const chatRepository = nativeBackend.chat
export const exercisesRepository = nativeBackend.exercises
export const favoriteWorkoutsRepository = nativeBackend.favoriteWorkouts
export const goalsRepository = nativeBackend.goals
export const invitationsRepository = nativeBackend.invitations
export const legalRepository = nativeBackend.legal
export const progressRepository = nativeBackend.progress
export const pushNotificationsRepository = nativeBackend.pushNotifications
export const realtimeRepository = nativeBackend.realtime
export const trainerProfilesRepository = nativeBackend.trainerProfiles
export const trainingSummariesRepository = nativeBackend.trainingSummaries
export const workoutTemplatesRepository = nativeBackend.workoutTemplates
export const workoutsRepository = nativeBackend.workouts
export const appFeedbackRepository = nativeBackend.appFeedback
