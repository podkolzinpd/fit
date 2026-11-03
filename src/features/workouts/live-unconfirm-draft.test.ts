import { afterEach, expect, it } from 'vitest'
import type { WorkoutSet } from '../../shared/domain'
import { liveUnconfirmDraft } from './live-unconfirm-draft'
const set: WorkoutSet = { id: 'set', position: 0, version: 3, confirmedAt: '2026-11-03T09:00:00Z', timerConfirmed: true,
  fact: { weightKg: 30, reps: 12, durationMin: 1.5, distanceKm: 1.2, rpe: 7 },
  metricSources: { duration: 'entered', distance: 'entered', rpe: 'entered' } }
afterEach(() => document.body.replaceChildren())
function form(controls: string) { document.body.innerHTML = `<form>${controls}</form>`; return document.querySelector('form')! }
it('preserves hidden RPE, time, distance and provenance while saving the last visible input', () => {
  const draft = liveUnconfirmDraft(set, form('<input name="weightKg" value="32.5"><input name="reps" value="12">'), { weightKg: 32.5, reps: 12 })
  expect(draft).toMatchObject({ weightKg: 32.5, reps: 12, durationMin: 1.5, distanceKm: 1.2, rpe: 7, metricSources: set.metricSources })
  expect(draft.timerConfirmed).toBeUndefined()
})
it('keeps an explicit clear of a visible field without clearing hidden fields', () => {
  const draft = liveUnconfirmDraft(set, form('<input name="weightKg" value="">'), { weightKg: undefined })
  expect(draft.weightKg).toBeUndefined()
  expect(draft.rpe).toBe(7)
  expect(draft.distanceKm).toBe(1.2)
})
it('normalizes a visible duration to seconds without leaving a competing minute value', () => {
  const draft = liveUnconfirmDraft(set, form('<input name="durationSec" value="100">'), { durationSec: 100 })
  expect(draft.durationSec).toBe(100)
  expect(draft.durationMin).toBeUndefined()
  expect(draft.weightKg).toBe(30)
})
it('retains an untouched timer mark until the atomic server undo succeeds', () => {
  const draft = liveUnconfirmDraft(set, form('<input name="weightKg" value="30"><input name="reps" value="12">'), { weightKg: 30, reps: 12 })
  expect(draft.timerConfirmed).toBe(true)
})
