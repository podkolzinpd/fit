import { afterEach, describe, expect, it, vi } from 'vitest'

const { getSession, verifiedAccessToken, refreshAccessToken } = vi.hoisted(() => ({
  getSession: vi.fn(),
  verifiedAccessToken: vi.fn(),
  refreshAccessToken: vi.fn(),
}))
vi.mock('./client', () => ({ getSupabaseClient: () => ({ auth: { getSession } }) }))
vi.mock('./verified-supabase-session', () => ({
  verifiedSupabaseAccessToken: verifiedAccessToken,
  refreshSupabaseAccessToken: refreshAccessToken,
}))

import { invokeLegacyCloudFunction } from './legacy-cloud-functions'

describe('legacy cloud functions transport', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    getSession.mockReset()
    verifiedAccessToken.mockReset()
    refreshAccessToken.mockReset()
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

  it('refreshes a server-rejected summary session once and retries with the new token', async () => {
    vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', 'https://stage.example.test')
    verifiedAccessToken.mockResolvedValue('stale-token')
    refreshAccessToken.mockResolvedValue('fresh-token')
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'authentication_required' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cached: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(invokeLegacyCloudFunction('summarize-client-training', { client_id: 'client-1' })).resolves.toMatchObject({
      data: { cached: true }, error: null,
    })
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(new Headers((fetch.mock.calls[0]?.[1] as RequestInit).headers).get('x-supabase-authorization')).toBe('Bearer stale-token')
    expect(new Headers((fetch.mock.calls[1]?.[1] as RequestInit).headers).get('x-supabase-authorization')).toBe('Bearer fresh-token')
  })

  it('never retries non-authentication failures or parser requests', async () => {
    vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', 'https://stage.example.test')
    verifiedAccessToken.mockResolvedValue('summary-token')
    getSession.mockResolvedValue({ data: { session: { access_token: 'parser-token' } } })
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'summary_generation_cooldown' }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'authentication_required' }), { status: 401 }))
    vi.stubGlobal('fetch', fetch)

    await invokeLegacyCloudFunction('summarize-client-training', {})
    await invokeLegacyCloudFunction('parse-workout', {})
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it('stops after one refresh when the replacement token is also rejected', async () => {
    vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', 'https://stage.example.test')
    verifiedAccessToken.mockResolvedValue('stale-token')
    refreshAccessToken.mockResolvedValue('still-stale-token')
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'authentication_required' }), { status: 401 }))
    vi.stubGlobal('fetch', fetch)

    const result = await invokeLegacyCloudFunction('summarize-client-training', {})
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    if (!result?.error || result.error instanceof Error) throw new Error('expected response context')
    expect(result.error.context.status).toBe(401)
  })
})
