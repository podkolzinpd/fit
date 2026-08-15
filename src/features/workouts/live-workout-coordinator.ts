import { RepositoryError, isRepositoryConflict, isRepositoryNetworkError } from '../../data/repositories/error'
import type { Workout } from '../../shared/domain'

type LiveWorkoutOperation = (expectedVersion: number) => Promise<number>

export function createLiveWorkoutCoordinator() {
  const versions = new Map<string, number>()
  const tails = new Map<string, Promise<void>>()
  const pending = new Map<string, Promise<number>>()

  function sync(workout: Workout): void {
    versions.set(workout.id, Math.max(versions.get(workout.id) ?? workout.version, workout.version))
  }

  function run(workout: Workout, operationKey: string, operation: LiveWorkoutOperation): Promise<number> {
    const pendingKey = `${workout.id}:${operationKey}`
    const duplicate = pending.get(pendingKey)
    if (duplicate) return duplicate

    const previous = tails.get(workout.id) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(async () => {
      const expectedVersion = Math.max(versions.get(workout.id) ?? workout.version, workout.version)
      const nextVersion = await operation(expectedVersion)
      versions.set(workout.id, nextVersion)
      return nextVersion
    })
    const settled = current.then(() => undefined, () => undefined)
    tails.set(workout.id, settled)
    pending.set(pendingKey, current)
    void current.then(
      () => {
        if (pending.get(pendingKey) === current) pending.delete(pendingKey)
        if (tails.get(workout.id) === settled) tails.delete(workout.id)
      },
      () => {
        if (pending.get(pendingKey) === current) pending.delete(pendingKey)
        if (tails.get(workout.id) === settled) tails.delete(workout.id)
      },
    )
    return current
  }

  return { run, sync }
}

export function liveWorkoutRecoveryError(error: unknown, refreshed: boolean): unknown {
  if (isRepositoryConflict(error)) {
    return new RepositoryError(
      'live_workout_conflict',
      refreshed
        ? 'Тренировка изменилась в другом окне. Мы обновили данные — проверьте их и повторите действие.'
        : 'Тренировка изменилась в другом окне. Не удалось обновить данные — проверьте интернет и повторите.',
      { cause: error },
    )
  }
  if (isRepositoryNetworkError(error)) {
    return new RepositoryError(
      'live_workout_network',
      refreshed
        ? 'Ответ сервера не получен. Мы обновили тренировку — проверьте результат перед повтором.'
        : 'Не удалось связаться с сервером. Введённые данные сохранены на устройстве; проверьте интернет и повторите.',
      { cause: error },
    )
  }
  return error
}
