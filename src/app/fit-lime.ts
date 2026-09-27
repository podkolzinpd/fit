import type { SessionActor } from '../shared/domain'

/** Fit Lime is assigned by the server and never inferred from Schedule V2. */
export function isFitLimeEnabled(actor: SessionActor | null | undefined): boolean {
  return actor?.role === 'trainer' && actor.experiments?.fitLime === true
}
