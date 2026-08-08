import type { ExerciseSnapshot, Workout } from '../../shared/domain'

function workoutRecency(left: Workout, right: Workout): number {
  return right.workoutDate.localeCompare(left.workoutDate)
    || (right.startTime ?? '').localeCompare(left.startTime ?? '')
    || (right.completedAt ?? right.startedAt ?? '').localeCompare(left.completedAt ?? left.startedAt ?? '')
    || right.id.localeCompare(left.id)
}

/** Последние уникальные упражнения клиента: от самой свежей тренировки назад. */
export function recentExercisesForClient(
  catalog: readonly ExerciseSnapshot[],
  workouts: readonly Workout[],
  limit = 8,
): ExerciseSnapshot[] {
  const catalogByKey = new Map(catalog.map((exercise) => [`${exercise.source}:${exercise.ref}`, exercise]))
  const seen = new Set<string>()
  const result: ExerciseSnapshot[] = []

  for (const workout of [...workouts].sort(workoutRecency)) {
    for (const exercise of workout.exercises) {
      const key = `${exercise.source}:${exercise.ref}`
      const catalogExercise = catalogByKey.get(key)
      if (!catalogExercise || seen.has(key)) continue
      seen.add(key)
      result.push(catalogExercise)
      if (result.length === limit) return result
    }
  }
  return result
}
