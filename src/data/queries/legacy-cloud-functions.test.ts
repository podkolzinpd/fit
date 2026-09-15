import { afterEach, describe, expect, it, vi } from 'vitest'

const { getSession, verifiedAccessToken } = vi.hoisted(() => ({
  getSession: vi.fn(),
  verifiedAccessToken: vi.fn(),
}))
vi.mock('./client', () => ({ supabase: { auth: { getSession } } }))
vi.mock('./verified-supabase-session', () => ({ verifiedSupabaseAccessToken: verifiedAccessToken }))

import { invokeLegacyCloudFunction } from './legacy-cloud-functions'

describe('legacy cloud functions transport', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    getSession.mockReset()
    verifiedAccessToken.mockReset()
  })

  it('keeps Supabase Edge Functions as the default until the isolated cloud base URL is configured', async () => {
    vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', '')

    await expect(invokeLegacyCloudFunction('parse-workout', {})).resolves.toBeUndefined()
    expect(getSession).not.toHaveBeenCalled()
  })

  it('sends a Supabase session only in the dedicated bridge header', async () => {
    vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', 'https://stage.example.test/')
    getSession.mockResolvedValue({ data: { session: { access_token: 'supabase-token' } } })
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], unmatched: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(invokeLegacyCloudFunction('parse-workout', { text: 'присед', systemCatalog: [] })).resolves.toEqual({
      data: { items: [], unmatched: [] }, error: null,
    })
    expect(fetch).toHaveBeenCalledWith('https://stage.example.test/v1/legacy/parse-workout', expect.objectContaining({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-supabase-authorization': 'Bearer supabase-token',
      },
    }))
  })

  it('verifies the session before requesting a paid training summary', async () => {
    vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', 'https://stage.example.test')
    verifiedAccessToken.mockResolvedValue('verified-token')
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ cached: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(invokeLegacyCloudFunction('summarize-client-training', {})).resolves.toEqual({
      data: { cached: true }, error: null,
    })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://stage.example.test/v1/legacy/summarize-client-training')
    expect(new Headers(init.headers).get('x-supabase-authorization')).toBe('Bearer verified-token')
  })

  it('does not call the summary endpoint when the session cannot be recovered', async () => {
    vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', 'https://stage.example.test')
    verifiedAccessToken.mockRejectedValue(new Error('authentication_required'))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const result = await invokeLegacyCloudFunction('summarize-client-training', {})
    expect(result?.data).toBeNull()
    expect(result?.error).toBeInstanceOf(Error)
    expect((result?.error as Error).message).toBe('authentication_required')
    expect(fetch).not.toHaveBeenCalled()
  })
})
