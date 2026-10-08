import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionActor } from '../shared/domain'
import { isCoachWorkoutRedesignEnabled } from './coach-workout-redesign'

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
