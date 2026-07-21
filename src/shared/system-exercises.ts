import type { ExerciseSnapshot } from './domain'

export const SYSTEM_EXERCISES = [
  { source: 'system', ref: 'barbell-squat', name: 'Присед со штангой', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'bench-press', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'deadlift', name: 'Становая тяга', muscleGroup: 'back', inputKind: 'strength' },
  { source: 'system', ref: 'pull-ups', name: 'Подтягивания', muscleGroup: 'back', inputKind: 'reps' },
  { source: 'system', ref: 'running', name: 'Бег', muscleGroup: 'cardio', inputKind: 'distance' },
] as const satisfies readonly ExerciseSnapshot[]
