import { beforeEach, describe, expect, it } from 'vitest'
import { claimLiveAutostart, DEFAULT_EXECUTION_MODE, effectiveExecutionMode, elapsedWorkSeconds, formatPrepOption, personWorkSeconds, livePhasePrimaryAction, restoreLiveExecutionMode, restoreLivePhase, storeLiveExecutionMode, storeLivePhase, timedSetSeconds, timerAssumesPlannedValues } from './live-phase'

describe('live phase timer', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear() })

  // В режиме «Ведёт таймер» время в плане главнее типа упражнения (YAFIT-627).
  it('times every unconfirmed set with a planned time, whatever the exercise type', () => {
    expect(timedSetSeconds({ durationSec: 45, confirmedAt: null })).toBe(45)
    expect(timedSetSeconds({ durationMin: 1.5, confirmedAt: null })).toBe(90)
    expect(timedSetSeconds({ confirmedAt: null })).toBeNull()
    expect(timedSetSeconds({ durationSec: 0, confirmedAt: null })).toBeNull()
    expect(timedSetSeconds({ durationSec: 45, confirmedAt: '2026-10-06T10:00:00Z' })).toBeNull()
    // Исправленное в Live время сохраняется в факт, отсчёт идёт от него, а не от плана.
    expect(timedSetSeconds({ durationSec: 45, fact: { durationSec: 30 }, confirmedAt: null })).toBe(30)
    expect(timedSetSeconds({ durationSec: 45, fact: {}, confirmedAt: null })).toBe(45)
  })

  // «Веду сам»: после нуля время идёт дальше, засчитывается фактическое, а не план.
  it('records the actual time of a person-led set past the planned zero', () => {
    expect(personWorkSeconds({ startedAt: 0 }, 23_400)).toBe(23)
    expect(personWorkSeconds({ startedAt: 0 }, 200)).toBe(1)
  })

  it('asks to check only sets where the timer took values it does not measure', () => {
    expect(timerAssumesPlannedValues({})).toBe(false)
    expect(timerAssumesPlannedValues({ reps: 15 })).toBe(true)
    expect(timerAssumesPlannedValues({ weightKg: 0 })).toBe(true)
    expect(timerAssumesPlannedValues({ distanceKm: 1 })).toBe(true)
  })

  it('defaults new and old workouts to the person leading them', () => {
    expect(DEFAULT_EXECUTION_MODE).toBe('manual')
    expect(effectiveExecutionMode(undefined, null)).toBe('manual')
    expect(effectiveExecutionMode('timer', null)).toBe('timer')
    expect(effectiveExecutionMode('timer', 'manual')).toBe('manual')
  })

  it('remembers the mode chosen in Live for this workout session only', () => {
    expect(restoreLiveExecutionMode('w1')).toBeNull()
    storeLiveExecutionMode('w1', 'manual')
    expect(restoreLiveExecutionMode('w1')).toBe('manual')
    expect(restoreLiveExecutionMode('w2')).toBeNull()
    sessionStorage.setItem('fit:live-execution-mode:w3', 'auto')
    expect(restoreLiveExecutionMode('w3')).toBeNull()
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
