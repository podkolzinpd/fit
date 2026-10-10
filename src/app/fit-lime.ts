import type { SessionActor } from '../shared/domain'
import { isTrainerScheduleV2CalendarRoute, isTrainerScheduleV2Enabled } from './trainer-schedule-v2'

/** Fit Lime is assigned by the server and never inferred from Schedule V2. */
export function isFitLimeEnabled(actor: SessionActor | null | undefined): boolean {
  return actor?.role === 'trainer' && actor.experiments?.fitLime === true
}

/** Released Fit Lime routes. This list alone does not activate styling. */
function isAdditionalTrainerRoute(pathname: string): boolean {
  return pathname === '/finance' || /^\/clients\/[^/]+\/finance$/.test(pathname)
    || ['/schedule/templates', '/schedule/templates/new', '/schedule/templates/new/editor', '/schedule/templates/from-workout'].includes(pathname)
    || /^\/schedule\/templates\/[^/]+\/(?:edit|assign)$/.test(pathname)
}

export function isFitLimeApprovedTrainerRoute(pathname: string, search: string): boolean {
  if (isAdditionalTrainerRoute(pathname)) return true
  if (pathname === '/today') return isTrainerScheduleV2CalendarRoute(pathname, search)
    || ['compose', 'review', 'save'].includes(new URLSearchParams(search).get('view') ?? '')
  if (pathname === '/schedule' || pathname === '/join' || pathname === '/chat'
    || pathname === '/clients' || pathname === '/clients/archive'
    || pathname === '/clients/new' || pathname === '/exercises'
    || pathname === '/workouts/new' || pathname === '/assistant'
    || pathname === '/profile' || pathname === '/profile/settings'
    || pathname === '/profile/trainer') return true
  return /^\/chat\/[^/]+$/.test(pathname)
    || /^\/clients\/[^/]+(?:\/(?:goal|edit|workouts|nutrition))?$/.test(pathname)
    || /^\/progress\/[^/]+$/.test(pathname)
    || /^\/workouts\/[^/]+\/edit$/.test(pathname)
    || /^\/workouts\/[^/]+$/.test(pathname)
    || /^\/workouts\/[^/]+\/live$/.test(pathname)
    || /^\/workouts\/[^/]+\/history\/[^/]+$/.test(pathname)
}

/** Activate only released trainer surfaces. */
export function isFitLimeShellRoute(
  actor: SessionActor | null | undefined,
  pathname: string,
  search: string,
): boolean {
  if (!isFitLimeEnabled(actor) || !isFitLimeApprovedTrainerRoute(pathname, search)) return false
  return isTrainerScheduleV2Enabled(actor)
    && (isAdditionalTrainerRoute(pathname) || isTrainerScheduleV2CalendarRoute(pathname, search)
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
      || /^\/workouts\/[^/]+$/.test(pathname)
      || /^\/workouts\/[^/]+\/live$/.test(pathname)
      || /^\/workouts\/[^/]+\/history\/[^/]+$/.test(pathname)
      || pathname === '/assistant'
      || pathname === '/profile' || pathname === '/profile/settings' || pathname === '/profile/trainer')
}
