import batchOne from './vital-gym-pro-catalog-batch-1.mjs'
import remaining from './vital-gym-pro-catalog-remaining.mjs'

export const REVIEWED_VITAL_GYM_PRO_BATCHES = [batchOne, remaining]

export function reviewedVitalGymProExercises() {
  return REVIEWED_VITAL_GYM_PRO_BATCHES.flatMap((batch) => batch.exercises)
}
