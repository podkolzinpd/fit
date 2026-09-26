import type { Workout } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'

export interface TrainerHomeContext {
  workout: Workout
  title: 'Текущая тренировка' | 'Ближайшая тренировка' | 'Последняя тренировка'
}

export function trainerHomeContext(workouts: Workout[], today: LocalDate): TrainerHomeContext | null {
  const current = workouts.find((workout) => workout.status === 'in_progress')
  if (current) return { workout: current, title: 'Текущая тренировка' }

  const upcoming = workouts
    .filter((workout) => workout.status === 'planned' && workout.workoutDate >= today)
    .sort((a, b) => `${a.workoutDate}${a.startTime ?? ''}${a.id}`.localeCompare(`${b.workoutDate}${b.startTime ?? ''}${b.id}`))[0]
  if (upcoming) return { workout: upcoming, title: 'Ближайшая тренировка' }

  const latest = workouts
    .filter((workout) => workout.status === 'done')
    .sort((a, b) => `${b.workoutDate}${b.startTime ?? ''}${b.id}`.localeCompare(`${a.workoutDate}${a.startTime ?? ''}${a.id}`))[0]
  return latest ? { workout: latest, title: 'Последняя тренировка' } : null
}
