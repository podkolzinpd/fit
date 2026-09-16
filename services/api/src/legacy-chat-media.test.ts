import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from './app.js'
import { LegacyChatMediaBridge, SupabaseLegacyChatMediaAuthorizer } from './legacy-chat-media.js'
import { SupabaseBridge } from './supabase-bridge.js'

const conversationId = '10000000-0000-4000-8000-000000000001'
const messageId = '10000000-0000-4000-8000-000000000002'
const path = `${conversationId}/${messageId}.jpg`
const config = { url: 'https://supabase.example.test', publishableKey: 'public-key', serviceRoleKey: 'service-key' }
const apps: ReturnType<typeof buildApp>[] = []

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

function fixture(status = 204) {
  // PostgREST returns no body for the real authorize_chat_* RETURNS void RPCs.
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }))
  const storage = {
    read: vi.fn(), write: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ sizeBytes: 3 }),
    sign: vi.fn().mockResolvedValue('https://storage.example.test/signed.jpg'),
    remove: vi.fn().mockResolvedValue(undefined),
  }
  const legacy = { upload: vi.fn(), sign: vi.fn(), remove: vi.fn() }
  const bridge = new LegacyChatMediaBridge(
    new SupabaseLegacyChatMediaAuthorizer(new SupabaseBridge(config, request)), storage, legacy,
  )
  const app = buildApp({ legacyChatMediaBridge: bridge, logger: false })
  apps.push(app)
  const invoke = (action: string) => app.inject({
    method: 'POST', url: `/v1/legacy/chat-media/${action}`,
    headers: { 'x-supabase-authorization': 'Bearer actor-token' },
    payload: { conversationId, messageId,
      ...(action === 'upload' ? { image: {
        dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg', width: 2, height: 2, sizeBytes: 3,
      } } : {}),
    },
  })
  return { invoke, request, storage, legacy }
}

describe('legacy chat media with real Supabase authorization adapter', () => {
  it('uploads after a successful empty authorization response', async () => {
    const { invoke, request, storage, legacy } = fixture()
    expect((await invoke('upload')).statusCode).toBe(204)
    expect(request).toHaveBeenCalledWith(`${config.url}/rest/v1/rpc/authorize_chat_send`, expect.objectContaining({
      body: JSON.stringify({ p_conversation_id: conversationId }),
    }))
    const headers = new Headers(request.mock.calls[0]?.[1]?.headers)
    expect(headers.get('apikey')).toBe('public-key')
    expect(headers.get('authorization')).toBe('Bearer actor-token')
    expect(storage.write).toHaveBeenCalledWith('chat-media', path, Buffer.from([1, 2, 3]), 'image/jpeg', false)
    expect(legacy.upload).not.toHaveBeenCalled()
  })

  it.each(['sign', 'remove'])('%s accepts empty authorization responses too', async (action) => {
    const { invoke, request, storage } = fixture()
    const response = await invoke(action)
    expect(response.statusCode).toBe(action === 'sign' ? 200 : 204)
    expect(request).toHaveBeenCalledWith(
      `${config.url}/rest/v1/rpc/authorize_chat_media_${action === 'sign' ? 'read' : 'remove'}`,
      expect.objectContaining({ body: JSON.stringify({ p_conversation_id: conversationId, p_message_id: messageId }) }),
    )
    expect(action === 'sign' ? storage.sign : storage.remove).toHaveBeenCalledWith('chat-media', path)
  })

  it.each([401, 403, 404, 500])('keeps storage inaccessible when authorization returns %s', async (status) => {
    const { invoke, storage } = fixture(status)
    for (const action of ['upload', 'sign', 'remove']) {
      expect((await invoke(action)).statusCode).toBe(status === 404 ? 403 : status === 500 ? 503 : status)
    }
    for (const operation of Object.values(storage)) expect(operation).not.toHaveBeenCalled()
  })
})
