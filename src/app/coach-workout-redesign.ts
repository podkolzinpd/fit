import type { SessionActor } from '../shared/domain'
import { isFitLimeEnabled } from './fit-lime'
import { isCoachLiveDensityPilotEnabled, isCoachPlanInputPilotEnabled, isCoachPlanLayoutPilotEnabled, isCoachWorkoutRedesignPilotEnabled } from './feature-flags'

export function isCoachWorkoutRedesignEnabled(actor: SessionActor | null | undefined): boolean {
  return isFitLimeEnabled(actor) && !!actor && isCoachWorkoutRedesignPilotEnabled(actor.userId)
}

export function isCoachPlanInputEnabled(actor: SessionActor | null | undefined): boolean {
  return isCoachWorkoutRedesignEnabled(actor) && !!actor && isCoachPlanInputPilotEnabled(actor.userId)
}

export function isCoachPlanLayoutEnabled(actor: SessionActor | null | undefined): boolean {
  return isCoachWorkoutRedesignEnabled(actor) && !!actor && isCoachPlanLayoutPilotEnabled(actor.userId)
}

export function isCoachLiveDensityEnabled(actor: SessionActor | null | undefined): boolean {
  return isCoachWorkoutRedesignEnabled(actor) && !!actor && isCoachLiveDensityPilotEnabled(actor.userId)
}
