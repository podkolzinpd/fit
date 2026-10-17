import type { SessionActor } from '../shared/domain'
import { isFitLimeEnabled } from './fit-lime'
import { isCoachPlanInputPilotEnabled, isCoachWorkoutRedesignPilotEnabled } from './feature-flags'

export function isCoachWorkoutRedesignEnabled(actor: SessionActor | null | undefined): boolean {
  return isFitLimeEnabled(actor) && !!actor && isCoachWorkoutRedesignPilotEnabled(actor.userId)
}

export function isCoachPlanInputEnabled(actor: SessionActor | null | undefined): boolean {
  return isCoachWorkoutRedesignEnabled(actor) && !!actor && isCoachPlanInputPilotEnabled(actor.userId)
}
