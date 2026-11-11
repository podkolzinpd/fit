import type { WorkoutTrainingFormat } from '../../shared/domain'

/** Presence is chosen by the author, not inferred from a financial service. */
export function defaultWorkoutTrainingFormat(role: 'trainer' | 'client'): WorkoutTrainingFormat {
  return role === 'trainer' ? 'with_trainer' : 'self'
}

export function workoutTrainingFormatLabel(format: WorkoutTrainingFormat, deliveryMode?: 'in_person' | 'online'): string {
  return format === 'with_trainer' ? deliveryMode === 'online' ? 'Онлайн' : 'С тренером' : 'Самостоятельно'
}
