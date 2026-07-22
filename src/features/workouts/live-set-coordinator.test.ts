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
})
