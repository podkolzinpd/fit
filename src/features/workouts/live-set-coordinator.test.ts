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

  it('continues the queue after a failed save and retries with the same version', async () => {
    const saveLiveSet = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(2)
    const coordinator = createLiveSetCoordinator(saveLiveSet, vi.fn())

    await expect(coordinator.save(set, draft)).rejects.toThrow('network')
    await expect(coordinator.save(set, draft)).resolves.toBe(2)
    expect(saveLiveSet).toHaveBeenNthCalledWith(2, 'set-1', draft, 1)
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
