import type { SessionActor } from '../shared/domain'

export function isTrainerScheduleV2Enabled(actor: SessionActor | null | undefined): boolean {
  return actor?.role === 'trainer' && actor.experiments?.trainerScheduleV2 === true
}

/** The trainer's workout composer shares /today with the pilot calendar. */
export function isTrainerScheduleV2CalendarRoute(pathname: string, search: string): boolean {
  if (pathname === '/schedule') return true
  if (pathname !== '/today') return false

  const params = new URLSearchParams(search)
  const view = params.get('view')
  return params.get('classic') !== '1' && view !== 'compose' && view !== 'review' && view !== 'save'
}
