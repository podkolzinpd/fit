import type { SessionActor } from '../shared/domain'
import { isClientLimeEnabled } from './client-lime'
import { isClientWorkoutRedesignPilotEnabled } from './feature-flags'

/** Presentation-only client pilot; never inherits a trainer or nutrition cohort. */
export function isClientWorkoutRedesignEnabled(actor: SessionActor | null | undefined): boolean {
  return isClientLimeEnabled(actor) && !!actor && isClientWorkoutRedesignPilotEnabled(actor.userId)
}
