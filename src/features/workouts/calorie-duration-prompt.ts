import type { Workout, WorkoutDraft } from '../../shared/domain'

/** Only a person's entered duration can support an active-calorie estimate.
 * A copied plan is not evidence of performed cardio time. */
export function firstCardioSetMissingEnteredDuration(workout: Pick<Workout, 'exercises'>) {
  for (const exercise of workout.exercises) {
    if (exercise.muscleGroup !== 'cardio') continue
    for (const set of exercise.sets) {
      if (!set.confirmedAt) continue
      const distance = set.fact.distanceKm ?? set.distanceKm
      if (!distance || distance <= 0) continue
      const duration = set.fact.durationSec ?? (set.fact.durationMin === undefined
        ? undefined : Math.round(set.fact.durationMin * 60))
      if (set.metricSources?.duration === 'entered' && duration && duration > 0) continue
      return { exerciseId: exercise.id, exerciseName: exercise.name, setId: set.id }
    }
  }
  return null
}

export function firstCardioDraftMissingEnteredDuration(draft: Pick<WorkoutDraft, 'exercises'>) {
  for (const exercise of draft.exercises) {
    if (exercise.muscleGroup !== 'cardio') continue
    for (const set of exercise.sets) {
      if (!set.distanceKm || set.distanceKm <= 0) continue
      const duration = set.durationSec ?? (set.durationMin === undefined
        ? undefined : Math.round(set.durationMin * 60))
      if (set.metricSources?.duration === 'entered' && duration && duration > 0) continue
      return exercise.name
    }
  }
  return null
}
