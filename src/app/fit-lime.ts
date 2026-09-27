import type { SessionActor } from '../shared/domain'
import { isTrainerScheduleV2CalendarRoute, isTrainerScheduleV2Enabled } from './trainer-schedule-v2'

/** Fit Lime is assigned by the server and never inferred from Schedule V2. */
export function isFitLimeEnabled(actor: SessionActor | null | undefined): boolean {
  return actor?.role === 'trainer' && actor.experiments?.fitLime === true
}

/** Product scope approved for stage 3. This list alone does not activate styling. */
export function isFitLimeApprovedTrainerRoute(pathname: string, search: string): boolean {
  if (pathname === '/today') return isTrainerScheduleV2CalendarRoute(pathname, search)
  if (pathname === '/schedule' || pathname === '/join' || pathname === '/chat'
    || pathname === '/clients' || pathname === '/clients/archive'
    || pathname === '/clients/new' || pathname === '/exercises'
    || pathname === '/profile' || pathname === '/profile/settings'
    || pathname === '/profile/trainer') return true
  return /^\/chat\/[^/]+$/.test(pathname)
    || /^\/clients\/[^/]+(?:\/(?:goal|edit|workouts))?$/.test(pathname)
    || /^\/progress\/[^/]+$/.test(pathname)
}

/** Activate only released trainer surfaces. */
export function isFitLimeShellRoute(
  actor: SessionActor | null | undefined,
  pathname: string,
  search: string,
): boolean {
  if (!isFitLimeEnabled(actor) || !isFitLimeApprovedTrainerRoute(pathname, search)) return false
  return isTrainerScheduleV2Enabled(actor)
    && (isTrainerScheduleV2CalendarRoute(pathname, search)
      || pathname === '/chat' || /^\/chat\/[^/]+$/.test(pathname)
      || pathname === '/clients' || pathname === '/clients/archive'
      || (/^\/clients\/[^/]+$/.test(pathname) && pathname !== '/clients/new'))
}
