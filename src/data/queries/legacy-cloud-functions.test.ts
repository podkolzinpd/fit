import { afterEach, describe, expect, it, vi } from 'vitest'

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('./client', () => ({ supabase: { auth: { getSession } } }))

import { invokeLegacyCloudFunction } from './legacy-cloud-functions'

describe('legacy cloud functions transport', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    getSession.mockReset()
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
})
