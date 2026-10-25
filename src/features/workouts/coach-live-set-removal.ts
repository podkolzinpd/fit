import type { WorkoutSet } from '../../shared/domain'

type RemovalState = {
  exercises: readonly { sets: readonly (Pick<WorkoutSet, 'id' | 'confirmedAt'> & Partial<Pick<WorkoutSet, 'version'>>)[] }[]
}

export type LiveSetRemovalIntent = { setId: string; expectedSetVersion?: number; confirmedVersion?: number; operationId?: string }

// Recheck the current cache at execution time, including a retry after conflict.
// The existing server command still provides ownership/version/last-set guards.
export function coachLiveSetRemovalError(workout: RemovalState | undefined, setId: string, approval?: LiveSetRemovalIntent): string | null {
  if (!workout) return 'Тренировка ещё не загружена. Дождитесь обновления.'
  if (approval && approval.setId !== setId) return 'Выберите подход и подтвердите удаление заново.'
  const exercise = workout.exercises.find((item) => item.sets.some((set) => set.id === setId))
  const set = exercise?.sets.find((item) => item.id === setId)
  if (!exercise || !set) return 'Этот подход уже удалён. Обновите тренировку.'
  if (approval?.expectedSetVersion !== undefined && set.version !== approval.expectedSetVersion) return 'Подход изменился. Проверьте результат и подтвердите удаление заново.'
  if (set.confirmedAt && (approval?.confirmedVersion === undefined || set.version !== approval.confirmedVersion)) return 'Подход уже подтверждён. Удаление остановлено, чтобы сохранить результат.'
  if (exercise.sets.length <= 1) return 'Последний подход упражнения нельзя удалить.'
  return null
}
