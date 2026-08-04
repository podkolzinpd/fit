import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTodayStartRedesignEnabled, isWearablesPilotEnabled, trainerHomePath } from './feature-flags'

afterEach(() => vi.unstubAllEnvs())

describe('today start redesign flag', () => {
  it('enables the new start path by default', () => {
    vi.stubEnv('VITE_TODAY_START_REDESIGN', '')
    expect(isTodayStartRedesignEnabled()).toBe(true)
    expect(trainerHomePath()).toBe('/today')
  })

  it('keeps the previous trainer start path available for rollback', () => {
    vi.stubEnv('VITE_TODAY_START_REDESIGN', 'false')
    expect(isTodayStartRedesignEnabled()).toBe(false)
    expect(trainerHomePath()).toBe('/clients')
  })
})

describe('wearables pilot flag', () => {
  it('is disabled by default even for an allowlisted user', () => {
    vi.stubEnv('VITE_WEARABLES_ENABLED', '')
    vi.stubEnv('VITE_WEARABLES_PILOT_USER_IDS', 'client-1')
    expect(isWearablesPilotEnabled('client-1')).toBe(false)
  })

  it('is enabled only for an explicitly allowlisted user', () => {
    vi.stubEnv('VITE_WEARABLES_ENABLED', 'true')
    vi.stubEnv('VITE_WEARABLES_PILOT_USER_IDS', ' client-1, client-2 ')
    expect(isWearablesPilotEnabled('client-1')).toBe(true)
    expect(isWearablesPilotEnabled('client-3')).toBe(false)
  })

  it('requires a non-empty allowlist', () => {
    vi.stubEnv('VITE_WEARABLES_ENABLED', 'true')
    vi.stubEnv('VITE_WEARABLES_PILOT_USER_IDS', '')
    expect(isWearablesPilotEnabled('client-1')).toBe(false)
  })
})
