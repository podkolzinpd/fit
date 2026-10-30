import type { Workout, WorkoutExercise } from '../../shared/domain'
import { factLine } from '../../data/repositories/workout-rules'

export interface ChronicleExercisePreview<T> {
  visible: T[]
  hiddenCount: number
}

export function chronicleExercisePreview<T>(exercises: T[], maxVisible = 2): ChronicleExercisePreview<T> {
  const visibleCount = Math.max(0, maxVisible)
  return {
    visible: exercises.slice(0, visibleCount),
    hiddenCount: Math.max(0, exercises.length - visibleCount),
  }
}

/** A calendar day reads recorded facts, never planned or unconfirmed values. */
export function calendarExerciseResult(exercise: Pick<WorkoutExercise, 'ref' | 'sets'>): string | null {
  const lines = exercise.sets.flatMap((set) => factLine(set, false, exercise.ref) ?? [])
  const first = lines[0]
  if (!first) return null
  return lines.length > 1 && lines.every((line) => line === first)
    ? `${lines.length} × ${first}` : lines.join(' · ')
}

/** Display-only fallback; never backfill a legacy workout in storage. */
export function workoutDisplayTitle(workout: Pick<Workout, 'title' | 'favoriteTitle'>): string {
  return workout.title?.trim() || workout.favoriteTitle?.trim() || 'Тренировка'
}

/** One compact summary for history cards and appointment history selection. */
export function workoutExerciseBrief(exercises: ReadonlyArray<Pick<WorkoutExercise, 'name'>>): string {
  const names = exercises.slice(0, 3).map(exercise => exercise.name)
  if (exercises.length > 3) names.push(`ещё ${exercises.length - 3}`)
  return names.join(' · ') || 'Без упражнений'
}
