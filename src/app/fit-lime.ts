import type { SessionActor } from '../shared/domain'
import { isTrainerScheduleV2CalendarRoute, isTrainerScheduleV2Enabled } from './trainer-schedule-v2'

/** Fit Lime is assigned by the server and never inferred from Schedule V2. */
export function isFitLimeEnabled(actor: SessionActor | null | undefined): boolean {
  return actor?.role === 'trainer' && actor.experiments?.fitLime === true
}

/** Released Fit Lime routes. This list alone does not activate styling. */
export function isFitLimeApprovedTrainerRoute(pathname: string, search: string): boolean {
  if (pathname === '/today') return isTrainerScheduleV2CalendarRoute(pathname, search)
    || ['compose', 'review', 'save'].includes(new URLSearchParams(search).get('view') ?? '')
  if (pathname === '/schedule' || pathname === '/join' || pathname === '/chat'
    || pathname === '/clients' || pathname === '/clients/archive'
    || pathname === '/clients/new' || pathname === '/exercises'
    || pathname === '/workouts/new'
    || pathname === '/profile' || pathname === '/profile/settings'
    || pathname === '/profile/trainer') return true
  return /^\/chat\/[^/]+$/.test(pathname)
    || /^\/clients\/[^/]+(?:\/(?:goal|edit|workouts))?$/.test(pathname)
    || /^\/progress\/[^/]+$/.test(pathname)
    || /^\/workouts\/[^/]+\/edit$/.test(pathname)
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
      || (pathname === '/today' && ['compose', 'review', 'save'].includes(new URLSearchParams(search).get('view') ?? ''))
      || pathname === '/chat' || /^\/chat\/[^/]+$/.test(pathname)
      || pathname === '/clients' || pathname === '/clients/archive'
      || pathname === '/clients/new' || /^\/clients\/[^/]+\/edit$/.test(pathname)
      || (/^\/clients\/[^/]+$/.test(pathname) && pathname !== '/clients/new')
      || /^\/clients\/[^/]+\/goal$/.test(pathname)
      || /^\/clients\/[^/]+\/workouts$/.test(pathname)
      || /^\/progress\/[^/]+$/.test(pathname)
      || pathname === '/join'
      || pathname === '/exercises'
      || pathname === '/workouts/new' || /^\/workouts\/[^/]+\/edit$/.test(pathname)
      || pathname === '/profile' || pathname === '/profile/settings' || pathname === '/profile/trainer')
}
