import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getYandexIdPilotConfig,
  isTodayStartRedesignEnabled,
  isWearablesPilotEnabled,
  trainerHomePath,
} from './feature-flags'

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

describe('Yandex ID pilot config', () => {
  it('is disabled by default even when public settings exist', () => {
    vi.stubEnv('VITE_YANDEX_ID_PILOT_ENABLED', '')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
    expect(getYandexIdPilotConfig()).toBeNull()
  })

  it('requires both public settings when explicitly enabled', () => {
    vi.stubEnv('VITE_YANDEX_ID_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', '')
    expect(getYandexIdPilotConfig()).toBeNull()
  })

  it('accepts HTTPS stage and localhost API URLs', () => {
    vi.stubEnv('VITE_YANDEX_ID_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', ' public-client-id ')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test/')
    expect(getYandexIdPilotConfig()).toEqual({
      apiBaseUrl: 'https://stage.example.test',
      clientId: 'public-client-id',
    })

    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'http://localhost:8080')
    expect(getYandexIdPilotConfig()?.apiBaseUrl).toBe('http://localhost:8080')
  })

  it('rejects an insecure remote API URL', () => {
    vi.stubEnv('VITE_YANDEX_ID_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'http://stage.example.test')
    expect(getYandexIdPilotConfig()).toBeNull()
  })
})
