import type { WorkoutTrainingFormat } from '../../shared/domain'

/** Presence is chosen by the author, not inferred from a financial service. */
export function defaultWorkoutTrainingFormat(role: 'trainer' | 'client'): WorkoutTrainingFormat {
  return role === 'trainer' ? 'with_trainer' : 'self'
}

export function workoutTrainingFormatLabel(format: WorkoutTrainingFormat): string {
  return format === 'with_trainer' ? 'С тренером' : 'Самостоятельно'
}
