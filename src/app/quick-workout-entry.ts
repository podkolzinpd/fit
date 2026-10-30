import type { SessionActor } from '../shared/domain'
import { isFitLimeEnabled } from './fit-lime'
import { isClientLimeEnabled } from './client-lime'
import { isQuickWorkoutEntryPilotEnabled, quickWorkoutEntryRolloutMode } from './feature-flags'

/** This rollout never inherits another presentation or feature admission. */
export function isQuickWorkoutEntryEnabled(actor: SessionActor | null | undefined): boolean {
  return !!actor && (actor.role === 'trainer' || actor.role === 'client')
    && isQuickWorkoutEntryPilotEnabled(actor.userId)
    && (quickWorkoutEntryRolloutMode() === 'all' || isFitLimeEnabled(actor) || isClientLimeEnabled(actor))
}
