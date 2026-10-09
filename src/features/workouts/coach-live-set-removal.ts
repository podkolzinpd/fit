import type { WorkoutSet } from '../../shared/domain'

type RemovalState = {
  exercises: readonly { sets: readonly Pick<WorkoutSet, 'id' | 'confirmedAt'>[] }[]
}

// Recheck the current cache at execution time, including a retry after conflict.
// The existing server command still provides ownership/version/last-set guards.
export function coachLiveSetRemovalError(workout: RemovalState | undefined, setId: string): string | null {
  if (!workout) return 'Тренировка ещё не загружена. Дождитесь обновления.'
  const exercise = workout.exercises.find((item) => item.sets.some((set) => set.id === setId))
  const set = exercise?.sets.find((item) => item.id === setId)
  if (!exercise || !set) return 'Этот подход уже удалён. Обновите тренировку.'
  if (set.confirmedAt) return 'Подход уже подтверждён. Удаление остановлено, чтобы сохранить результат.'
  if (exercise.sets.length <= 1) return 'Последний подход упражнения нельзя удалить.'
  return null
}
