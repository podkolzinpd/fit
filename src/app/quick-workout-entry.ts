import type { SessionActor } from '../shared/domain'
import { isFitLimeEnabled } from './fit-lime'
import { isClientLimeEnabled } from './client-lime'
import { isQuickWorkoutEntryPilotEnabled } from './feature-flags'

/** This experiment never inherits the all-trainer presentation rollout. */
export function isQuickWorkoutEntryEnabled(actor: SessionActor | null | undefined): boolean {
  return !!actor && (isFitLimeEnabled(actor) || isClientLimeEnabled(actor)) && isQuickWorkoutEntryPilotEnabled(actor.userId)
}
