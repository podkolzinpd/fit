import type { Workout } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'

/** One dot per day; a plan takes precedence over completed attendance. */
export function workoutDateMarks(workouts: readonly Pick<Workout, 'id' | 'clientId' | 'status' | 'workoutDate'>[], clientId: string, excludeWorkoutId?: string) {
  const marks: Partial<Record<LocalDate, 'planned' | 'done'>> = {}
  for (const workout of workouts) {
    if (workout.clientId !== clientId || workout.id === excludeWorkoutId) continue
    if (workout.status === 'planned' || workout.status === 'in_progress') marks[workout.workoutDate] = 'planned'
    else if (workout.status === 'done' && !marks[workout.workoutDate]) marks[workout.workoutDate] = 'done'
  }
  return marks
}

