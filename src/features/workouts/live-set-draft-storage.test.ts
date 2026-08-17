import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPendingLiveSetDrafts, readPendingLiveSetDrafts, removePendingLiveSetDraft, writePendingLiveSetDraft } from './live-set-draft-storage'

describe('pending live set draft storage', () => {
  let values: Map<string, string>

  beforeEach(() => {
    values = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  it('restores drafts only for the same user and workout', () => {
    writePendingLiveSetDraft('trainer-1', 'workout-1', 'set-1', { weightKg: 52.5, reps: 8 })

    expect(readPendingLiveSetDrafts('trainer-1', 'workout-1').get('set-1')).toEqual({ weightKg: 52.5, reps: 8 })
    expect(readPendingLiveSetDrafts('trainer-2', 'workout-1')).toEqual(new Map())
    expect(readPendingLiveSetDrafts('trainer-1', 'workout-2')).toEqual(new Map())
  })

  it('removes one acknowledged draft without losing the rest', () => {
    writePendingLiveSetDraft('trainer-1', 'workout-1', 'set-1', { reps: 8 })
    writePendingLiveSetDraft('trainer-1', 'workout-1', 'set-2', { reps: 10 })

    removePendingLiveSetDraft('trainer-1', 'workout-1', 'set-1')

    expect([...readPendingLiveSetDrafts('trainer-1', 'workout-1')]).toEqual([['set-2', { reps: 10 }]])
  })

  it('clears all drafts after the workout is completed', () => {
    writePendingLiveSetDraft('trainer-1', 'workout-1', 'set-1', { reps: 8 })

    clearPendingLiveSetDrafts('trainer-1', 'workout-1')

    expect(readPendingLiveSetDrafts('trainer-1', 'workout-1')).toEqual(new Map())
  })

  it('ignores malformed persisted values', () => {
    values.set('fit.live-set-drafts.trainer-1.workout-1', JSON.stringify({ 'set-1': { reps: 'ten' } }))

    expect(readPendingLiveSetDrafts('trainer-1', 'workout-1')).toEqual(new Map())
  })
})
