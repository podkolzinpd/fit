import { describe, expect, it, vi } from 'vitest'

import { SupabaseBridge } from './supabase-bridge.js'

const config = { url: 'https://supabase.example.test', publishableKey: 'public-key', serviceRoleKey: 'service-key' }

describe('SupabaseBridge response decoding', () => {
  it('accepts 204 No Content from void RPCs', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    await expect(new SupabaseBridge(config, request).rpc<void>('authorize_chat_send', {}, 'actor-token'))
      .resolves.toBeUndefined()
  })

  it.each([null, { allowed: true }, [{ id: 'test' }]])('preserves JSON results: %j', async (value) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(value))
    await expect(new SupabaseBridge(config, request).rpc('test', {}, 'actor-token')).resolves.toEqual(value)
  })

  it('still rejects malformed non-204 responses', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 200 }))
    await expect(new SupabaseBridge(config, request).rpc('test', {}, 'actor-token')).rejects.toThrow(SyntaxError)
  })
})
