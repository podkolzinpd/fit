import type { ExerciseSnapshot, Workout } from '../../shared/domain'

/** Упражнения, к которым тренер чаще всего возвращается именно у этого клиента. */
export function frequentExercisesForClient(
  catalog: readonly ExerciseSnapshot[],
  workouts: readonly Workout[],
  limit = 8,
): ExerciseSnapshot[] {
  const catalogByKey = new Map(catalog.map((exercise) => [`${exercise.source}:${exercise.ref}`, exercise]))
  const usage = new Map<string, { count: number; lastDate: string }>()
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      const key = `${exercise.source}:${exercise.ref}`
      const current = usage.get(key)
      usage.set(key, { count: (current?.count ?? 0) + 1, lastDate: current?.lastDate && current.lastDate > workout.workoutDate ? current.lastDate : workout.workoutDate })
    }
  }
  return [...usage.entries()]
    .sort(([, left], [, right]) => right.count - left.count || right.lastDate.localeCompare(left.lastDate))
    .flatMap(([key]) => catalogByKey.get(key) ?? [])
    .slice(0, limit)
}
