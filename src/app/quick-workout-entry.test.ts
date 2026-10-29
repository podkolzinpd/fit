import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionActor } from '../shared/domain'
import { isQuickWorkoutEntryEnabled } from './quick-workout-entry'

const actor = (userId = 'first', role: 'trainer' | 'client' = 'trainer') => ({ userId, role, experiments: { fitLime: true, clientLime: true } }) as SessionActor
afterEach(() => vi.unstubAllEnvs())
describe('independent quick workout two-account pilot', () => {
  it('stays closed by default even when coach presentation is public', () => {
    vi.stubEnv('VITE_COACH_WORKOUT_ROLLOUT_MODE', 'all')
    vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_ENABLED', '')
    vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_PILOT_USER_IDS', 'first,second')
    expect(isQuickWorkoutEntryEnabled(actor())).toBe(false)
  })
  it('admits only the distinct pair in either admitted product role', () => {
    vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_ENABLED', 'true')
    vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_PILOT_USER_IDS', ' first, , second ')
    vi.stubEnv('VITE_CLIENT_LIME_ENABLED', 'true')
    for (const role of ['trainer', 'client'] as const) {
      expect(isQuickWorkoutEntryEnabled(actor('first', role))).toBe(true)
      expect(isQuickWorkoutEntryEnabled(actor('second', role))).toBe(true)
      expect(isQuickWorkoutEntryEnabled(actor('outsider', role))).toBe(false)
    }
    expect(isQuickWorkoutEntryEnabled(null)).toBe(false)
  })
  it('closes malformed, incomplete and widened cohorts', () => {
    vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_ENABLED', 'true')
    for (const ids of ['', 'first', 'first,first', 'first,second,third']) {
      vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_PILOT_USER_IDS', ids)
      expect(isQuickWorkoutEntryEnabled(actor())).toBe(false)
    }
  })
})
