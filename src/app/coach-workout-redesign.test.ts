import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionActor } from '../shared/domain'
import { isCoachLiveDensityEnabled, isCoachPlanInputEnabled, isCoachPlanLayoutEnabled, isCoachWorkoutRedesignEnabled } from './coach-workout-redesign'

afterEach(() => vi.unstubAllEnvs())
const actor = (id = 'trainer-1', role = 'trainer', fitLime = true) => ({ userId: id, role, experiments: { fitLime } }) as SessionActor
describe('independent coach workout reference pilot', () => {
  it('fails closed unless explicitly enabled with exactly two distinct identities', () => {
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_PILOT_USER_IDS', 'trainer-1,trainer-2')
    for (const value of ['', 'false', 'TRUE']) {
      vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_ENABLED', value)
      expect(isCoachWorkoutRedesignEnabled(actor())).toBe(false)
    }
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_ENABLED', 'true')
    for (const ids of ['', 'trainer-1', 'trainer-1,trainer-1', 'trainer-1,trainer-2,trainer-3']) {
      vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_PILOT_USER_IDS', ids)
      expect(isCoachWorkoutRedesignEnabled(actor())).toBe(false)
    }
  })
  it('enables the two trainers only, never clients, outsiders or absent/non-Lime actors', () => {
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_ENABLED', 'true')
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_PILOT_USER_IDS', ' trainer-1, , trainer-2 ')
    expect(isCoachWorkoutRedesignEnabled(actor())).toBe(true)
    expect(isCoachWorkoutRedesignEnabled(actor('trainer-2'))).toBe(true)
    expect(isCoachWorkoutRedesignEnabled(actor('trainer-3'))).toBe(false)
    expect(isCoachWorkoutRedesignEnabled(actor('trainer-1', 'client'))).toBe(false)
    expect(isCoachWorkoutRedesignEnabled(actor('trainer-1', 'trainer', false))).toBe(false)
    expect(isCoachWorkoutRedesignEnabled(null)).toBe(false)
  })
})

describe.each([
  ['input', isCoachPlanInputEnabled, 'VITE_COACH_PLAN_INPUT'],
  ['layout', isCoachPlanLayoutEnabled, 'VITE_COACH_PLAN_LAYOUT'],
  ['live density', isCoachLiveDensityEnabled, 'VITE_COACH_LIVE_DENSITY'],
] as const)('closed coach plan %s pilot', (_label, enabledFor, prefix) => {
  it('requires an independent switch, exactly two IDs and the original trainer pilot', () => {
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_ENABLED', 'true')
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_PILOT_USER_IDS', 'trainer-1,trainer-2')
    vi.stubEnv(`${prefix}_PILOT_USER_IDS`, 'trainer-1,trainer-2')
    for (const enabled of ['', 'false', 'TRUE']) {
      vi.stubEnv(`${prefix}_ENABLED`, enabled)
      expect(enabledFor(actor())).toBe(false)
    }
    vi.stubEnv(`${prefix}_ENABLED`, 'true')
    expect(enabledFor(actor())).toBe(true)
    expect(enabledFor(actor('trainer-2'))).toBe(true)
    expect(enabledFor(actor('trainer-3'))).toBe(false)
    expect(enabledFor(actor('trainer-1', 'client'))).toBe(false)
    expect(enabledFor(actor('trainer-1', 'trainer', false))).toBe(false)
    expect(enabledFor(null)).toBe(false)
    for (const ids of ['', 'trainer-1', 'trainer-1,trainer-1', 'trainer-1,trainer-2,trainer-3']) {
      vi.stubEnv(`${prefix}_PILOT_USER_IDS`, ids)
      expect(enabledFor(actor())).toBe(false)
    }
    vi.stubEnv(`${prefix}_PILOT_USER_IDS`, ' trainer-1, , trainer-2 ')
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_ENABLED', 'false')
    expect(enabledFor(actor())).toBe(false)
  })
})

describe.each([
  ['redesign', isCoachWorkoutRedesignEnabled, 'VITE_COACH_WORKOUT_REDESIGN'],
  ['input', isCoachPlanInputEnabled, 'VITE_COACH_PLAN_INPUT'],
  ['layout', isCoachPlanLayoutEnabled, 'VITE_COACH_PLAN_LAYOUT'],
  ['density', isCoachLiveDensityEnabled, 'VITE_COACH_LIVE_DENSITY'],
] as const)('explicit all-trainer %s rollout', (_label, enabledFor, prefix) => {
  it('admits server-approved trainers without widening client or other feature gates', () => {
    vi.stubEnv('VITE_COACH_WORKOUT_ROLLOUT_MODE', 'all')
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_ENABLED', 'true')
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_PILOT_USER_IDS', '')
    vi.stubEnv(`${prefix}_ENABLED`, 'true')
    vi.stubEnv(`${prefix}_PILOT_USER_IDS`, '')
    expect(enabledFor(actor('new-trainer'))).toBe(true)
    expect(enabledFor(actor('new-trainer', 'client'))).toBe(false)
    expect(enabledFor(actor('new-trainer', 'trainer', false))).toBe(false)
    expect(enabledFor(null)).toBe(false)
    vi.stubEnv(`${prefix}_ENABLED`, 'false')
    expect(enabledFor(actor('new-trainer'))).toBe(false)
    vi.stubEnv(`${prefix}_ENABLED`, 'true')
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_ENABLED', 'false')
    expect(enabledFor(actor('new-trainer'))).toBe(false)
  })
  it('closes invalid/off modes and rolls back to the original pair', () => {
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_ENABLED', 'true')
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_PILOT_USER_IDS', 'trainer-1,trainer-2')
    vi.stubEnv(`${prefix}_ENABLED`, 'true')
    vi.stubEnv(`${prefix}_PILOT_USER_IDS`, 'trainer-1,trainer-2')
    for (const mode of ['off', '', 'ALL', 'typo']) {
      vi.stubEnv('VITE_COACH_WORKOUT_ROLLOUT_MODE', mode)
      expect(enabledFor(actor())).toBe(false)
    }
    vi.stubEnv('VITE_COACH_WORKOUT_ROLLOUT_MODE', 'all')
    expect(enabledFor(actor('new-trainer'))).toBe(true)
    vi.stubEnv('VITE_COACH_WORKOUT_ROLLOUT_MODE', 'pilot')
    expect(enabledFor(actor('new-trainer'))).toBe(false)
    expect(enabledFor(actor())).toBe(true)
  })
})
