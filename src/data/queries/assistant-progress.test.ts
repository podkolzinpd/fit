import { afterEach, describe, expect, it, vi } from 'vitest'

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('./client', () => ({ supabase: { auth: { getSession } } }))

import { invokeAssistantProgressSummary } from './assistant-progress'

describe('assistant progress transport', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    getSession.mockReset()
  })

  it('remains inert unless an explicit local or stage bridge URL is configured', async () => {
    vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', '')
    await expect(invokeAssistantProgressSummary({
      clientId: '6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', periodStart: '2026-08-01', periodEnd: '2026-08-20',
    })).resolves.toBeUndefined()
    expect(getSession).not.toHaveBeenCalled()
  })

  it('uses the narrow assistant endpoint and the existing isolated session header', async () => {
    vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', 'http://localhost:8080')
    getSession.mockResolvedValue({ data: { session: { access_token: 'supabase-token' } } })
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'summary-id' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(invokeAssistantProgressSummary<{ data: { id: string } }>({
      clientId: '6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', periodStart: '2026-08-01', periodEnd: '2026-08-20',
    })).resolves.toEqual({ data: { data: { id: 'summary-id' } }, error: null })
    expect(fetch).toHaveBeenCalledWith('http://localhost:8080/v1/assistant/progress-summary', expect.objectContaining({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-supabase-authorization': 'Bearer supabase-token',
      },
    }))
  })
})
