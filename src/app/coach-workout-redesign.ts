import type { SessionActor } from '../shared/domain'
import { isFitLimeEnabled } from './fit-lime'
import { isCoachWorkoutRedesignPilotEnabled } from './feature-flags'

export function isCoachWorkoutRedesignEnabled(actor: SessionActor | null | undefined): boolean {
  return isFitLimeEnabled(actor) && !!actor && isCoachWorkoutRedesignPilotEnabled(actor.userId)
}
