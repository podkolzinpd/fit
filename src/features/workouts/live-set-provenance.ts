import type { WorkoutMetricSources, WorkoutSet } from '../../shared/domain'

/** The form starts with plan hints; only an input event is evidence of entry. */
export function markLiveMetricEntered(form: HTMLFormElement, target: EventTarget) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
  if (target.name === 'durationSec' || target.name === 'runDuration') form.dataset.enteredDuration = '1'
  if (target.name === 'distanceKm' || target.name === 'runDistance') form.dataset.enteredDistance = '1'
  if (target.name === 'rpe') form.dataset.enteredRpe = '1'
}

export function liveMetricSources(form: HTMLFormElement, set: WorkoutSet): WorkoutMetricSources {
  return {
    duration: form.dataset.enteredDuration === '1' ? 'entered' : set.metricSources?.duration
      ?? (set.fact.durationSec === undefined && set.fact.durationMin === undefined
        && (set.durationSec !== undefined || set.durationMin !== undefined) ? 'planned' : 'unknown'),
    distance: form.dataset.enteredDistance === '1' ? 'entered' : set.metricSources?.distance
      ?? (set.fact.distanceKm === undefined && set.distanceKm !== undefined ? 'planned' : 'unknown'),
    rpe: form.dataset.enteredRpe === '1' ? 'entered' : set.metricSources?.rpe
      ?? (set.fact.rpe === undefined && set.rpe !== undefined ? 'planned' : 'unknown'),
  }
}
