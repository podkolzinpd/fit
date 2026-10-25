import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionActor } from '../shared/domain'
import { isCoachLiveV79Enabled } from './coach-live-v79'

afterEach(() => vi.unstubAllEnvs())
const actor = (userId = 'trainer-1', role = 'trainer') => ({ userId, role, experiments: { fitLime: true } }) as SessionActor
function configure() {
  for (const feature of ['COACH_WORKOUT_REDESIGN', 'COACH_LIVE_DENSITY', 'COACH_LIVE_V79']) {
    vi.stubEnv(`VITE_${feature}_ENABLED`, 'true')
    vi.stubEnv(`VITE_${feature}_PILOT_USER_IDS`, 'trainer-1,trainer-2')
  }
}
describe('coach Live v79 original-pair presentation', () => {
  it('requires its exact independent switch and both existing gates', () => {
    configure()
    for (const feature of ['COACH_WORKOUT_REDESIGN', 'COACH_LIVE_DENSITY', 'COACH_LIVE_V79']) {
      for (const value of ['', 'false', 'TRUE']) {
        vi.stubEnv(`VITE_${feature}_ENABLED`, value)
        expect(isCoachLiveV79Enabled(actor())).toBe(false)
      }
      vi.stubEnv(`VITE_${feature}_ENABLED`, 'true')
    }
    expect(isCoachLiveV79Enabled(actor())).toBe(true)
    expect(isCoachLiveV79Enabled(actor('trainer-2'))).toBe(true)
  })
  it('rejects another pair, duplicate, broad cohort, client and missing actor', () => {
    configure()
    for (const ids of ['', 'trainer-1', 'trainer-1,trainer-1', 'trainer-1,trainer-3', 'trainer-1,trainer-2,trainer-3']) {
      vi.stubEnv('VITE_COACH_LIVE_V79_PILOT_USER_IDS', ids)
      expect(isCoachLiveV79Enabled(actor())).toBe(false)
    }
    vi.stubEnv('VITE_COACH_LIVE_V79_PILOT_USER_IDS', ' trainer-2, ,trainer-1 ')
    expect(isCoachLiveV79Enabled(actor('trainer-3'))).toBe(false)
    expect(isCoachLiveV79Enabled(actor('trainer-1', 'client'))).toBe(false)
    expect(isCoachLiveV79Enabled(null)).toBe(false)
    expect(isCoachLiveV79Enabled(actor())).toBe(true)
  })
})
