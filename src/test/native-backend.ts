import { createYandexMainRepository } from '../data/repositories/yandex-main.repository'

export const nativeBackend = createYandexMainRepository('http://127.0.0.1:4100', 'a'.repeat(43), {
  kind: 'trainer', role: 'trainer', userId: '10000000-0000-4000-8000-000000000001',
  email: null, firstName: 'Trainer', lastName: null, timezone: 'Europe/Moscow',
})

// Unit media fixtures serve their local public assets without HTTP signing.
nativeBackend.exercises.vitalMediaMode = 'public'

export const exercisesRepository = nativeBackend.exercises
export const appFeedbackRepository = nativeBackend.appFeedback
