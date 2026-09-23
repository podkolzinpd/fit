import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn(() => ({ auth: {} })))

vi.mock('@supabase/supabase-js', () => ({ createClient }))

describe('getSupabaseClient', () => {
  beforeEach(() => {
    vi.resetModules()
    createClient.mockClear()
  })

  afterEach(() => vi.unstubAllEnvs())

  it('does not require Supabase configuration or create a client on import', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')

    const { getSupabaseClient } = await import('./client')

    expect(createClient).not.toHaveBeenCalled()
    expect(() => getSupabaseClient()).toThrow('Задайте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('creates one client only when a legacy query needs it', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key')
    const { getSupabaseClient } = await import('./client')

    expect(createClient).not.toHaveBeenCalled()
    expect(getSupabaseClient()).toBe(getSupabaseClient())
    expect(createClient).toHaveBeenCalledOnce()
  })

  it('does not require Supabase configuration to load a production bundle', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
    vi.stubEnv('VITE_YANDEX_APP_SESSION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_ONLY_AUTH_ENABLED', 'true')

    const { getSupabaseClient } = await import('./client')

    expect(createClient).not.toHaveBeenCalled()
    expect(() => getSupabaseClient()).toThrow('Войдите через Yandex ID, чтобы продолжить.')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('blocks a legacy query even if production still has Supabase credentials', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://legacy.example.test')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'legacy-public-key')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
    vi.stubEnv('VITE_YANDEX_APP_SESSION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_ONLY_AUTH_ENABLED', 'true')

    const { getSupabaseClient } = await import('./client')

    expect(() => getSupabaseClient()).toThrow('Войдите через Yandex ID, чтобы продолжить.')
    expect(createClient).not.toHaveBeenCalled()
  })
})
