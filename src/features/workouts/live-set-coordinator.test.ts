import { describe, expect, it, vi } from 'vitest'
import type { LiveSetDraft, WorkoutSet } from '../../shared/domain'
import { createLiveSetCoordinator } from './live-set-coordinator'

const set: WorkoutSet = {
  id: 'set-1', position: 0, fact: {}, confirmedAt: null, version: 1,
}
const draft: LiveSetDraft = { weightKg: 42.5, reps: 12 }

describe('live set coordinator', () => {
  it('serializes save and confirm using the latest server version', async () => {
    let finishSave: ((version: number) => void) | undefined
    const saveLiveSet = vi.fn(() => new Promise<number>((resolve) => { finishSave = resolve }))
    const confirmLiveSet = vi.fn(() => Promise.resolve(3))
    const coordinator = createLiveSetCoordinator(saveLiveSet, confirmLiveSet)

    const saving = coordinator.save(set, draft)
    const confirming = coordinator.confirm(set, draft)
    await vi.waitFor(() => expect(saveLiveSet).toHaveBeenCalledWith('set-1', draft, 1))
    expect(confirmLiveSet).not.toHaveBeenCalled()

    finishSave?.(2)
    await expect(saving).resolves.toBe(2)
    await expect(confirming).resolves.toBe(3)
    expect(saveLiveSet).toHaveBeenCalledOnce()
    expect(confirmLiveSet).toHaveBeenCalledWith('set-1', 2)
  })

  it('deduplicates repeated autosaves with the same draft', async () => {
    const saveLiveSet = vi.fn(() => Promise.resolve(2))
    const coordinator = createLiveSetCoordinator(saveLiveSet, vi.fn())

    await Promise.all([
      coordinator.save(set, draft),
      coordinator.save(set, { ...draft }),
      coordinator.save(set, { ...draft }),
    ])

    expect(saveLiveSet).toHaveBeenCalledOnce()
  })

  it('saves a confirmed cardio time even when it equals the previously saved plan', async () => {
    const saveLiveSet = vi.fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
    const confirmLiveSet = vi.fn().mockResolvedValue(4)
    const coordinator = createLiveSetCoordinator(saveLiveSet, confirmLiveSet)
    const planned: LiveSetDraft = {
      durationSec: 1800, distanceKm: 2.2,
      metricSources: { duration: 'planned', distance: 'entered', rpe: 'unknown' },
    }
    const entered: LiveSetDraft = {
      ...planned,
      metricSources: { duration: 'entered', distance: 'entered', rpe: 'unknown' },
    }

    await coordinator.save(set, planned)
    await coordinator.confirm(set, entered)

    expect(saveLiveSet).toHaveBeenCalledTimes(2)
    expect(saveLiveSet).toHaveBeenNthCalledWith(1, 'set-1', planned, 1)
    expect(saveLiveSet).toHaveBeenNthCalledWith(2, 'set-1', entered, 2)
    expect(confirmLiveSet).toHaveBeenCalledWith('set-1', 3)
  })

  // YAFIT-627: «Подтвердить» после засчёта таймером шлёт те же числа без пометки.
  it('saves the person confirmation of a timer-confirmed set with the same numbers', async () => {
    const saveLiveSet = vi.fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4)
    const coordinator = createLiveSetCoordinator(saveLiveSet, vi.fn().mockResolvedValue(3))
    const timed: LiveSetDraft = { durationSec: 30, metricSources: { duration: 'entered', distance: 'unknown', rpe: 'unknown' } }

    await coordinator.confirm(set, { ...timed, timerConfirmed: true })
    await coordinator.save(set, timed)

    expect(saveLiveSet).toHaveBeenCalledTimes(2)
    expect(saveLiveSet).toHaveBeenNthCalledWith(2, 'set-1', timed, 3)
  })

  it('continues the queue after a failed save and retries with the same version', async () => {
    const saveLiveSet = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(2)
    const coordinator = createLiveSetCoordinator(saveLiveSet, vi.fn())

    await expect(coordinator.save(set, draft)).rejects.toThrow('network')
    await expect(coordinator.save(set, draft)).resolves.toBe(2)
    expect(saveLiveSet).toHaveBeenNthCalledWith(2, 'set-1', draft, 1)
  })

  it('syncs the refreshed server version after an ambiguous response', async () => {
    const saveLiveSet = vi.fn(() => Promise.resolve(5))
    const coordinator = createLiveSetCoordinator(saveLiveSet, vi.fn())
    coordinator.sync({ ...set, fact: draft, version: 4 }, draft)

    await expect(coordinator.save(set, draft)).resolves.toBe(4)
    await expect(coordinator.save(set, { ...draft, reps: 13 })).resolves.toBe(5)
    expect(saveLiveSet).toHaveBeenCalledWith('set-1', { ...draft, reps: 13 }, 4)
  })

  it('clears a stale failed-save state when refetch proves the draft is on the server', async () => {
    const coordinator = createLiveSetCoordinator(
      vi.fn().mockRejectedValueOnce(new Error('response lost')),
      vi.fn(),
    )

    await expect(coordinator.save(set, draft)).rejects.toThrow('response lost')
    await expect(coordinator.waitForIdle()).rejects.toThrow('response lost')

    coordinator.sync({ ...set, fact: draft, version: 2 }, draft)

    await expect(coordinator.waitForIdle()).resolves.toBeUndefined()
  })

  it('prevents finish from passing a failed pending autosave', async () => {
    let failSave: ((error: Error) => void) | undefined
    const coordinator = createLiveSetCoordinator(
      vi.fn(() => new Promise<number>((_resolve, reject) => { failSave = reject })),
      vi.fn(),
    )

    const saving = coordinator.save(set, draft)
    const idle = coordinator.waitForIdle()
    await vi.waitFor(() => expect(failSave).toBeTypeOf('function'))
    failSave?.(new Error('network'))

    await expect(saving).rejects.toThrow('network')
    await expect(idle).rejects.toThrow('network')
  })

  it('deduplicates a double confirm while the first request is pending', async () => {
    let finishConfirm: ((version: number) => void) | undefined
    const confirmLiveSet = vi.fn(() => new Promise<number>((resolve) => { finishConfirm = resolve }))
    const coordinator = createLiveSetCoordinator(
      vi.fn(() => Promise.resolve(2)),
      confirmLiveSet,
    )

    const first = coordinator.confirm(set, draft)
    const duplicate = coordinator.confirm(set, draft)
    expect(duplicate).toBe(first)
    await vi.waitFor(() => expect(confirmLiveSet).toHaveBeenCalledOnce())
    finishConfirm?.(3)

    await expect(Promise.all([first, duplicate])).resolves.toEqual([3, 3])
    expect(confirmLiveSet).toHaveBeenCalledOnce()
  })
})

it('serializes save, confirmation and undo, deduplicating a double tap', async () => {
  let releaseSave!: (version: number) => void
  const save = vi.fn(() => new Promise<number>(resolve => { releaseSave = resolve }))
  const confirm = vi.fn(() => Promise.resolve(3))
  const undo = vi.fn(() => Promise.resolve(4))
  const coordinator = createLiveSetCoordinator(save, confirm, undo)
  const entered = { weightKg: 45, reps: 12 }
  const saved = coordinator.save(set, entered)
  const confirmed = coordinator.confirm(set, entered)
  const undone = coordinator.unconfirm(set, entered)
  const duplicate = coordinator.unconfirm(set, entered)
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
  expect(undo).not.toHaveBeenCalled()
  releaseSave(2)
  await expect(Promise.all([saved, confirmed, undone, duplicate])).resolves.toEqual([2, 3, 4, 4])
  expect(confirm).toHaveBeenCalledWith(set.id, 2)
  expect(undo).toHaveBeenCalledExactlyOnceWith(set.id, 3)
})

it('allows a failed undo to retry with the refreshed version without dropping its fact', async () => {
  const undo = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValue(5)
  const save = vi.fn(() => Promise.resolve(3))
  const coordinator = createLiveSetCoordinator(save, vi.fn(), undo)
  await expect(coordinator.unconfirm(set, draft)).rejects.toThrow('lost response')
  await expect(coordinator.waitForIdle()).rejects.toThrow('lost response')
  coordinator.sync({ ...set, version: 4, fact: draft, confirmedAt: '2026-11-03T09:00:00Z' }, draft)
  await expect(coordinator.unconfirm(set, draft)).resolves.toBe(5)
  expect(save).toHaveBeenCalledOnce()
  expect(undo).toHaveBeenNthCalledWith(2, set.id, 4)
  await expect(coordinator.waitForIdle()).resolves.toBeUndefined()
})
