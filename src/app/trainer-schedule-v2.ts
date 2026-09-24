import type { SessionActor } from '../shared/domain'

export function isTrainerScheduleV2Enabled(actor: SessionActor | null | undefined): boolean {
  return actor?.role === 'trainer' && actor.experiments?.trainerScheduleV2 === true
}
