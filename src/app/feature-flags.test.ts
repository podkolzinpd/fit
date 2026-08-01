import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTodayStartRedesignEnabled, trainerHomePath } from './feature-flags'

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
