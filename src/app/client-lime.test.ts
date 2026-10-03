import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionActor } from '../shared/domain'
import { isClientLimeShellRoute } from './client-lime'
const actor: SessionActor = { kind: 'client', firstName: null, lastName: null, fullName: 'Клиент', userId: 'client-1', role: 'client', email: 'unused@example.test', timezone: 'Europe/Moscow', clientId: 'card-1', trainerId: 'trainer-1' }
afterEach(() => vi.unstubAllEnvs())
describe('client Lime route scope', () => {
  it('isolates the actor, role and authenticated route family', () => {
    vi.stubEnv('VITE_CLIENT_LIME_ENABLED', 'true')
    vi.stubEnv('VITE_CLIENT_LIME_PILOT_USER_IDS', 'client-1')
    for (const route of ['/me', '/me/settings', '/me/workouts', '/me/progress', '/me/achievements', '/me/finance', '/me/trainers', '/chat/a', '/assistant', '/workouts/new', '/workouts/a/live', '/workouts/a/history/squat']) {
      expect(isClientLimeShellRoute(actor, route)).toBe(true)
      expect(isClientLimeShellRoute({ ...actor, userId: 'client-2' }, route)).toBe(false)
      expect(isClientLimeShellRoute({ ...actor, role: 'trainer' }, route)).toBe(false)
    }
    for (const route of ['/auth', '/legal/privacy', '/trainers/public', '/clients', '/me/unknown', '/workouts/a/unknown']) expect(isClientLimeShellRoute(actor, route)).toBe(false)
    expect(isClientLimeShellRoute(null, '/me')).toBe(false)
    vi.stubEnv('VITE_CLIENT_LIME_ENABLED', 'false')
    expect(isClientLimeShellRoute(actor, '/me')).toBe(false)
  })
})
