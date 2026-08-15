import { describe, expect, it, vi } from 'vitest'
import { RepositoryError } from '../../data/repositories/error'
import type { Workout } from '../../shared/domain'
import { createLiveWorkoutCoordinator, liveWorkoutRecoveryError } from './live-workout-coordinator'

const workout = { id: 'workout-1', version: 3 } as Workout

describe('live workout coordinator', () => {
  it('serializes root mutations and passes the latest returned version', async () => {
    let finishFirst: ((version: number) => void) | undefined
    const firstOperation = vi.fn(() => new Promise<number>((resolve) => { finishFirst = resolve }))
    const secondOperation = vi.fn(() => Promise.resolve(5))
    const coordinator = createLiveWorkoutCoordinator()

    const first = coordinator.run(workout, 'append:set-1', firstOperation)
    const second = coordinator.run(workout, 'finish', secondOperation)

    await vi.waitFor(() => expect(firstOperation).toHaveBeenCalledWith(3))
    expect(secondOperation).not.toHaveBeenCalled()
    finishFirst?.(4)

    await expect(first).resolves.toBe(4)
    await expect(second).resolves.toBe(5)
    expect(secondOperation).toHaveBeenCalledWith(4)
  })

  it('deduplicates the same action while its response is pending', async () => {
    let finish: ((version: number) => void) | undefined
    const operation = vi.fn(() => new Promise<number>((resolve) => { finish = resolve }))
    const coordinator = createLiveWorkoutCoordinator()

    const first = coordinator.run(workout, 'finish', operation)
    const duplicate = coordinator.run(workout, 'finish', operation)
    expect(duplicate).toBe(first)
    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce())
    finish?.(4)

    await expect(Promise.all([first, duplicate])).resolves.toEqual([4, 4])
    expect(operation).toHaveBeenCalledOnce()
  })

  it('adopts a newer server snapshot after an external edit', async () => {
    const coordinator = createLiveWorkoutCoordinator()
    coordinator.sync({ ...workout, version: 7 })
    const operation = vi.fn(() => Promise.resolve(8))

    await coordinator.run(workout, 'append:set-2', operation)

    expect(operation).toHaveBeenCalledWith(7)
  })

  it('continues the queue after a failed request', async () => {
    const coordinator = createLiveWorkoutCoordinator()
    const failed = coordinator.run(workout, 'append:set-1', () => Promise.reject(new Error('network')))
    const retried = coordinator.run(workout, 'append:set-2', (version) => Promise.resolve(version + 1))

    await expect(failed).rejects.toThrow('network')
    await expect(retried).resolves.toBe(4)
  })
})

describe('live workout recovery message', () => {
  it('explains a refreshed conflict without suggesting a blind overwrite', () => {
    const result = liveWorkoutRecoveryError(new RepositoryError('PT409', 'conflict'), true)

    expect(result).toMatchObject({ code: 'live_workout_conflict' })
    expect((result as Error).message).toContain('обновили данные')
  })

  it('explains an ambiguous network result', () => {
    const result = liveWorkoutRecoveryError(new RepositoryError('network_unavailable', 'network'), true)

    expect(result).toMatchObject({ code: 'live_workout_network' })
    expect((result as Error).message).toContain('проверьте результат')
  })
})
