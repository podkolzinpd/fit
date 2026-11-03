import type { LiveSetDraft, WorkoutSet } from '../../shared/domain'
import { sameLiveSetDraft } from './live-set-cache'

/** Undo is not an edit of hidden metrics. Only controls present in this form
 * can replace a stored fact; an explicitly cleared visible control still wins. */
export function liveUnconfirmDraft(set: WorkoutSet, form: HTMLFormElement, captured: LiveSetDraft): LiveSetDraft {
  const controls = new FormData(form)
  const draft: LiveSetDraft = { ...set.fact, metricSources: captured.metricSources ?? set.metricSources }
  if (controls.has('weightKg')) draft.weightKg = captured.weightKg
  if (controls.has('reps')) draft.reps = captured.reps
  if (controls.has('rpe')) draft.rpe = captured.rpe
  if (controls.has('distanceKm') || controls.has('runDistance')) draft.distanceKm = captured.distanceKm
  if (controls.has('durationSec') || controls.has('runDuration')) {
    draft.durationSec = captured.durationSec
    delete draft.durationMin
  }
  // An untouched timer review mark belongs to the atomic undo, not its save.
  if (set.timerConfirmed && sameLiveSetDraft(set.fact, draft)) draft.timerConfirmed = true
  return draft
}
