import { beforeEach, describe, expect, it } from 'vitest'
import { claimLiveAutostart, elapsedWorkSeconds, formatPrepOption, livePhasePrimaryAction, restoreLivePhase, storeLivePhase, timedSetSeconds } from './live-phase'

describe('live phase timer', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear() })

  it('times only unconfirmed duration sets with a planned duration', () => {
    expect(timedSetSeconds({ inputKind: 'duration' }, { durationSec: 45, confirmedAt: null })).toBe(45)
    expect(timedSetSeconds({ inputKind: 'duration' }, { durationMin: 1.5, confirmedAt: null })).toBe(90)
    expect(timedSetSeconds({ inputKind: 'duration' }, { confirmedAt: null })).toBeNull()
    expect(timedSetSeconds({ inputKind: 'duration' }, { durationSec: 45, confirmedAt: '2026-10-06T10:00:00Z' })).toBeNull()
    expect(timedSetSeconds({ inputKind: 'reps' }, { durationSec: 60, confirmedAt: null })).toBe(60)
    expect(timedSetSeconds({ inputKind: 'reps' }, { confirmedAt: null })).toBeNull()
    expect(timedSetSeconds({ inputKind: 'strength' }, { durationSec: 45, confirmedAt: null })).toBeNull()
    expect(timedSetSeconds({ inputKind: 'distance' }, { durationSec: 600, confirmedAt: null })).toBeNull()
  })

  it('records the elapsed time on an early tap and stops at the plan', () => {
    const timer = { startedAt: 1_000, endsAt: 46_000 }
    expect(elapsedWorkSeconds(timer, 24_400)).toBe(23)
    expect(elapsedWorkSeconds(timer, 46_000)).toBe(45)
    expect(elapsedWorkSeconds(timer, 90_000)).toBe(45)
    expect(elapsedWorkSeconds(timer, 1_100)).toBe(1)
  })

  it('maps a short tap to the next logical step of each phase', () => {
    const base = { phase: null, restEndsAt: null, now: 10_000, currentSetTimed: false }
    expect(livePhasePrimaryAction({ ...base, phase: { kind: 'prep', startedAt: 0, endsAt: 15_000 } })).toBe('skip-prep')
    expect(livePhasePrimaryAction({ ...base, phase: { kind: 'work', setId: 's', startedAt: 0, endsAt: 45_000 } })).toBe('confirm-work')
    expect(livePhasePrimaryAction({ ...base, restEndsAt: 60_000 })).toBe('stop-rest')
    expect(livePhasePrimaryAction({ ...base, restEndsAt: 5_000 })).toBe('clear-rest')
    expect(livePhasePrimaryAction({ ...base, currentSetTimed: true })).toBe('start-work')
    expect(livePhasePrimaryAction(base)).toBe('open-settings')
  })

  it('restores a stored phase and rejects malformed values', () => {
    storeLivePhase('w1', { kind: 'work', setId: 's1', startedAt: 1, endsAt: 2 })
    expect(restoreLivePhase('w1')).toEqual({ kind: 'work', setId: 's1', startedAt: 1, endsAt: 2 })
    storeLivePhase('w1', null)
    expect(restoreLivePhase('w1')).toBeNull()
    sessionStorage.setItem('fit:live-phase:w2', JSON.stringify({ kind: 'work', startedAt: 1, endsAt: 2 }))
    expect(restoreLivePhase('w2')).toBeNull()
    sessionStorage.setItem('fit:live-phase:w3', '{broken')
    expect(restoreLivePhase('w3')).toBeNull()
  })

  it('autostarts a workout only once', () => {
    expect(claimLiveAutostart('w1')).toBe(true)
    expect(claimLiveAutostart('w1')).toBe(false)
    expect(claimLiveAutostart('w2')).toBe(true)
  })

  it('formats prep options for the workout form', () => {
    expect(formatPrepOption(15)).toBe('15 сек')
    expect(formatPrepOption(60)).toBe('1 мин')
    expect(formatPrepOption(90)).toBe('1 мин 30 сек')
  })
})
