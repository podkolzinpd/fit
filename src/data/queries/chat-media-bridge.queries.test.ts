import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn()
vi.mock('./client', () => ({ getSupabaseClient: () => ({ auth: { getSession } }) }))

describe('chat media bridge transport', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    getSession.mockReset()
    getSession.mockResolvedValue({ data: { session: { access_token: 'supabase-token' } } })
    vi.stubGlobal('fetch', vi.fn())
  })

  it('keeps the Supabase token in the dedicated header while uploading to the configured Yandex API', async () => {
    vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', 'https://stage.example.test/')
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    const { chatMediaBridgeQueries } = await import('./chat-media-bridge.queries')

    const result = await chatMediaBridgeQueries.upload(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      { dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg', width: 2, height: 2, sizeBytes: 3 },
    )

    expect(result).toEqual({ data: null, error: null })
    expect(fetch).toHaveBeenCalledWith('https://stage.example.test/v1/legacy/chat-media/upload', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-supabase-authorization': 'Bearer supabase-token',
      },
      body: JSON.stringify({
        conversationId: '11111111-1111-4111-8111-111111111111',
        messageId: '22222222-2222-4222-8222-222222222222',
        image: { dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg', width: 2, height: 2, sizeBytes: 3 },
      }),
    })
  })

  it('stays undefined until the public API URL is explicitly configured', async () => {
    vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', '')
    const { chatMediaBridgeQueries } = await import('./chat-media-bridge.queries')
    await expect(chatMediaBridgeQueries.sign('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')).resolves.toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })
})
