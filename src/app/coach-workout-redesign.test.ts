import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionActor } from '../shared/domain'
import { isCoachPlanInputEnabled, isCoachWorkoutRedesignEnabled } from './coach-workout-redesign'

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

describe('closed coach plan input pilot', () => {
  it('requires an independent switch, exactly two IDs and the original trainer pilot', () => {
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_ENABLED', 'true')
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_PILOT_USER_IDS', 'trainer-1,trainer-2')
    vi.stubEnv('VITE_COACH_PLAN_INPUT_PILOT_USER_IDS', 'trainer-1,trainer-2')
    for (const enabled of ['', 'false', 'TRUE']) {
      vi.stubEnv('VITE_COACH_PLAN_INPUT_ENABLED', enabled)
      expect(isCoachPlanInputEnabled(actor())).toBe(false)
    }
    vi.stubEnv('VITE_COACH_PLAN_INPUT_ENABLED', 'true')
    expect(isCoachPlanInputEnabled(actor())).toBe(true)
    expect(isCoachPlanInputEnabled(actor('trainer-2'))).toBe(true)
    expect(isCoachPlanInputEnabled(actor('trainer-3'))).toBe(false)
    expect(isCoachPlanInputEnabled(actor('trainer-1', 'client'))).toBe(false)
    expect(isCoachPlanInputEnabled(actor('trainer-1', 'trainer', false))).toBe(false)
    expect(isCoachPlanInputEnabled(null)).toBe(false)
    for (const ids of ['', 'trainer-1', 'trainer-1,trainer-1', 'trainer-1,trainer-2,trainer-3']) {
      vi.stubEnv('VITE_COACH_PLAN_INPUT_PILOT_USER_IDS', ids)
      expect(isCoachPlanInputEnabled(actor())).toBe(false)
    }
    vi.stubEnv('VITE_COACH_PLAN_INPUT_PILOT_USER_IDS', ' trainer-1, , trainer-2 ')
    vi.stubEnv('VITE_COACH_WORKOUT_REDESIGN_ENABLED', 'false')
    expect(isCoachPlanInputEnabled(actor())).toBe(false)
  })
})
