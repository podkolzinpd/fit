import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionActor } from '../shared/domain'
import { isQuickWorkoutEntryEnabled } from './quick-workout-entry'

const actor = (userId = 'first', role: 'trainer' | 'client' = 'trainer') => ({ userId, role, experiments: { fitLime: true, clientLime: true } }) as SessionActor
afterEach(() => vi.unstubAllEnvs())
describe('independent quick workout rollout', () => {
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
  it('public mode admits ordinary actors in both existing appearances without widening other gates', () => {
    vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_ENABLED', 'true')
    vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_ROLLOUT_MODE', 'all')
    vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_PILOT_USER_IDS', '')
    for (const role of ['trainer', 'client'] as const) {
      const ordinary = { ...actor('ordinary', role), experiments: { trainerScheduleV2: false, fitLime: false, clientLime: false } }
      expect(isQuickWorkoutEntryEnabled(ordinary)).toBe(true)
    }
    expect(isQuickWorkoutEntryEnabled(actor(''))).toBe(false)
    expect(isQuickWorkoutEntryEnabled(null)).toBe(false)
    vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_ENABLED', 'false')
    expect(isQuickWorkoutEntryEnabled(actor('ordinary'))).toBe(false)
  })
  it('off or invalid mode fails closed and pilot can still isolate the original pair', () => {
    vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_ENABLED', 'true')
    vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_PILOT_USER_IDS', 'first,second')
    for (const mode of ['off', '', 'ALL', 'invalid']) {
      vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_ROLLOUT_MODE', mode)
      expect(isQuickWorkoutEntryEnabled(actor())).toBe(false)
    }
    vi.stubEnv('VITE_QUICK_WORKOUT_ENTRY_ROLLOUT_MODE', 'pilot')
    expect(isQuickWorkoutEntryEnabled(actor())).toBe(true)
    expect(isQuickWorkoutEntryEnabled(actor('ordinary'))).toBe(false)
  })

})
