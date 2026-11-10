import { expect, it } from 'vitest'
import { recoverLivePauseTimers, type LiveTimerSnapshot } from './live-pause-recovery'

const before: LiveTimerSnapshot = { rest: 90_000, phase: null, restRevision: 1, phaseRevision: 1, pausedAt: 60_000 }
const optimistic: LiveTimerSnapshot = { ...before, rest: 150_000, restRevision: 2, pausedAt: null }

it('restores untouched clocks after a failed resume', () => {
  expect(recoverLivePauseTimers(before, optimistic, optimistic, 60_000, 120_000)).toEqual({ rest: 90_000, phase: null })
})
it('preserves the new ninety seconds instead of the previous thirty', () => {
  const current = { ...optimistic, rest: 210_000, restRevision: 3 }
  expect(recoverLivePauseTimers(before, optimistic, current, 60_000, 120_000)).toEqual({ rest: 150_000, phase: null })
})
it('includes elapsed network time and preserves zero rest', () => {
  expect(recoverLivePauseTimers(before, optimistic, { ...optimistic, rest: 210_000, restRevision: 3 }, 60_000, 125_000).rest).toBe(145_000)
  expect(recoverLivePauseTimers(before, optimistic, { ...optimistic, rest: null, restRevision: 3 }, 60_000, 125_000).rest).toBeNull()
})
it('does not resurrect completed work after confirming a timed set', () => {
  const phase = { kind: 'work' as const, setId: 'set', startedAt: 30_000, endsAt: 90_000 }
  const original = { ...before, rest: null, phase }
  const shifted = { ...optimistic, rest: null, phase: { ...phase, startedAt: 90_000, endsAt: 150_000 }, phaseRevision: 2 }
  const current = { ...shifted, phase: null, phaseRevision: 3, rest: 210_000, restRevision: 3 }
  expect(recoverLivePauseTimers(original, shifted, current, 60_000, 120_000)).toEqual({ rest: 150_000, phase: null })
})
it('preserves a newer work timer and its elapsed time', () => {
  const phase = { kind: 'work' as const, setId: 'next', startedAt: 122_000, endsAt: 152_000 }
  const current = { ...optimistic, rest: null, restRevision: 3, phase, phaseRevision: 2 }
  expect(recoverLivePauseTimers(before, optimistic, current, 60_000, 125_000).phase).toEqual({ ...phase, startedAt: 57_000, endsAt: 87_000 })
})
it('uses server pause time and restores a failed pause to the running clock', () => {
  const running = { ...before, rest: 210_000, pausedAt: null }
  const paused = { ...running, pausedAt: 120_000 }
  expect(recoverLivePauseTimers(running, paused, paused, null, 125_000).rest).toBe(210_000)
  const updated = { ...paused, rest: 180_000, restRevision: 2 }
  expect(recoverLivePauseTimers(running, paused, updated, null, 125_000).rest).toBe(185_000)
  expect(recoverLivePauseTimers(before, optimistic, optimistic, 65_000, 125_000).rest).toBe(95_000)
})
