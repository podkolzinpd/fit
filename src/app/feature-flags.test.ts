import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getYandexIdPilotConfig,
  isAssistantNavPilotEnabled,
  isDarkThemePilotEnabled,
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

describe('assistant nav pilot flag', () => {
  it('is disabled when the enabled flag is missing or not exactly "true", even for an allowlisted user', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', '')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'trainer-1')
    expect(isAssistantNavPilotEnabled('trainer-1')).toBe(false)
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'TRUE')
    expect(isAssistantNavPilotEnabled('trainer-1')).toBe(false)
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', '1')
    expect(isAssistantNavPilotEnabled('trainer-1')).toBe(false)
  })

  it('is enabled for an allowlisted user when the flag is exactly "true"', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'trainer-1,trainer-2')
    expect(isAssistantNavPilotEnabled('trainer-1')).toBe(true)
  })

  it('is enabled only for an allowlisted email, case-insensitively', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', '')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_EMAILS', ' test@test.com ')
    expect(isAssistantNavPilotEnabled('trainer-1', 'TEST@test.com')).toBe(true)
    expect(isAssistantNavPilotEnabled('trainer-2', 'other@test.com')).toBe(false)
    expect(isAssistantNavPilotEnabled('trainer-3')).toBe(false)
  })

  it('is disabled for a user outside the allowlist', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'trainer-1,trainer-2')
    expect(isAssistantNavPilotEnabled('trainer-3')).toBe(false)
  })

  it('is disabled for everyone when the allowlist is empty or missing', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', '')
    expect(isAssistantNavPilotEnabled('trainer-1')).toBe(false)
  })

  it('trims whitespace and drops empty allowlist entries', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', ' , trainer-1 , ,trainer-2, ')
    expect(isAssistantNavPilotEnabled('trainer-1')).toBe(true)
    expect(isAssistantNavPilotEnabled('trainer-2')).toBe(true)
    expect(isAssistantNavPilotEnabled('')).toBe(false)
  })

  it('does not leak access between users and stays independent from the wearables allowlist', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'trainer-1')
    vi.stubEnv('VITE_WEARABLES_ENABLED', 'true')
    vi.stubEnv('VITE_WEARABLES_PILOT_USER_IDS', 'client-9')
    expect(isAssistantNavPilotEnabled('trainer-1')).toBe(true)
    expect(isAssistantNavPilotEnabled('client-9')).toBe(false)
    expect(isWearablesPilotEnabled('trainer-1')).toBe(false)
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

describe('dark theme pilot flag', () => {
  it('is disabled by default even for an allowlisted user', () => {
    vi.stubEnv('VITE_DARK_THEME_PILOT_ENABLED', '')
    vi.stubEnv('VITE_DARK_THEME_PILOT_USER_IDS', 'trainer-1')
    expect(isDarkThemePilotEnabled('trainer-1')).toBe(false)
  })

  it('requires the flag to be exactly "true"', () => {
    vi.stubEnv('VITE_DARK_THEME_PILOT_USER_IDS', 'trainer-1')
    vi.stubEnv('VITE_DARK_THEME_PILOT_ENABLED', 'TRUE')
    expect(isDarkThemePilotEnabled('trainer-1')).toBe(false)
    vi.stubEnv('VITE_DARK_THEME_PILOT_ENABLED', '1')
    expect(isDarkThemePilotEnabled('trainer-1')).toBe(false)
  })

  it('is enabled only for an explicitly allowlisted user', () => {
    vi.stubEnv('VITE_DARK_THEME_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_DARK_THEME_PILOT_USER_IDS', ' , trainer-1 , ,client-2, ')
    expect(isDarkThemePilotEnabled('trainer-1')).toBe(true)
    expect(isDarkThemePilotEnabled('client-2')).toBe(true)
    expect(isDarkThemePilotEnabled('trainer-3')).toBe(false)
    expect(isDarkThemePilotEnabled('')).toBe(false)
  })

  it('requires a non-empty allowlist', () => {
    vi.stubEnv('VITE_DARK_THEME_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_DARK_THEME_PILOT_USER_IDS', '')
    expect(isDarkThemePilotEnabled('trainer-1')).toBe(false)
  })

  it('stays independent from the wearables allowlist', () => {
    vi.stubEnv('VITE_DARK_THEME_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_DARK_THEME_PILOT_USER_IDS', 'trainer-1')
    vi.stubEnv('VITE_WEARABLES_ENABLED', 'true')
    vi.stubEnv('VITE_WEARABLES_PILOT_USER_IDS', 'client-9')
    expect(isDarkThemePilotEnabled('client-9')).toBe(false)
    expect(isWearablesPilotEnabled('trainer-1')).toBe(false)
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
