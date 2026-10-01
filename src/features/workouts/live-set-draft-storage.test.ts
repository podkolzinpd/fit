import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingLiveSetConfirmations,
  clearPendingLiveSetDrafts,
  readPendingLiveSetConfirmations,
  readPendingLiveSetDrafts,
  removePendingLiveSetConfirmation,
  removePendingLiveSetDraft,
  writePendingLiveSetConfirmation,
  writePendingLiveSetDraft,
} from './live-set-draft-storage'

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

  it('persists confirmation intent separately from the draft', () => {
    writePendingLiveSetDraft('trainer-1', 'workout-1', 'set-1', { reps: 8 })
    writePendingLiveSetConfirmation('trainer-1', 'workout-1', 'set-1')

    expect(readPendingLiveSetConfirmations('trainer-1', 'workout-1')).toEqual(new Set(['set-1']))
    expect(readPendingLiveSetDrafts('trainer-1', 'workout-1').get('set-1')).toEqual({ reps: 8 })

    removePendingLiveSetConfirmation('trainer-1', 'workout-1', 'set-1')
    expect(readPendingLiveSetConfirmations('trainer-1', 'workout-1')).toEqual(new Set())
    expect(readPendingLiveSetDrafts('trainer-1', 'workout-1').has('set-1')).toBe(true)
  })

  it('clears all confirmation intents after workout completion', () => {
    writePendingLiveSetConfirmation('trainer-1', 'workout-1', 'set-1')
    writePendingLiveSetConfirmation('trainer-1', 'workout-1', 'set-2')

    clearPendingLiveSetConfirmations('trainer-1', 'workout-1')

    expect(readPendingLiveSetConfirmations('trainer-1', 'workout-1')).toEqual(new Set())
  })
})
