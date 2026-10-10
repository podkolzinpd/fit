import type { SessionActor } from '../shared/domain'
import { isClientLimePilotEnabled } from './feature-flags'

export function isClientLimeEnabled(actor: SessionActor | null | undefined): boolean {
  return actor?.role === 'client' && isClientLimePilotEnabled(actor.userId, actor.experiments?.clientLime === true)
}
export function isClientLimeShellRoute(actor: SessionActor | null | undefined, pathname: string): boolean {
  if (!isClientLimeEnabled(actor)) return false
  return ['/me', '/me/edit', '/me/workouts', '/me/progress', '/me/achievements',
    '/me/goal', '/me/finance', '/me/nutrition', '/me/profile', '/me/settings', '/me/trainers',
    '/chat', '/assistant', '/join', '/workouts/new'].includes(pathname)
    || /^\/chat\/[^/]+$/.test(pathname)
    || /^\/workouts\/[^/]+(?:\/(?:edit|live|history\/[^/]+))?$/.test(pathname)
}
