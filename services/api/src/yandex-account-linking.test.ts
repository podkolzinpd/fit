import { describe, expect, it, vi } from 'vitest'

import { SupabaseBridge } from './supabase-bridge.js'
import { SupabaseExistingActorProvider } from './yandex-account-linking.js'

const config = {
  url: 'https://supabase.example.test',
  publishableKey: 'public-key',
  serviceRoleKey: 'service-key',
}
const actorId = 'a8e4d5cf-f021-4bfd-bd9e-62b1c30785c4'

function requestUrl(input: URL | RequestInfo): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

describe('SupabaseExistingActorProvider', () => {
  it('reads the exact authenticated trainer root without putting its UUID in the query URL', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input)
      if (url.endsWith('/auth/v1/user')) return Promise.resolve(Response.json({ id: actorId }))
      if (url.includes('/rest/v1/profiles?')) {
        return Promise.resolve(Response.json([{
          id: actorId,
          first_name: 'Fit',
          last_name: null,
          timezone: 'Europe/Moscow',
          account_role: 'trainer',
          created_at: '2026-08-01T10:00:00.000Z',
          updated_at: '2026-08-02T10:00:00.000Z',
        }]))
      }
      if (url.includes('/rest/v1/trainers?')) {
        return Promise.resolve(Response.json([{
          profile_id: actorId,
          created_at: '2026-08-01T10:00:00.000Z',
          updated_at: '2026-08-01T10:00:00.000Z',
        }]))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    await expect(new SupabaseExistingActorProvider(
      new SupabaseBridge(config, request),
    ).resolveActor('existing-session')).resolves.toEqual({
      profile: {
        id: actorId,
        firstName: 'Fit',
        lastName: null,
        timezone: 'Europe/Moscow',
        accountRole: 'trainer',
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-02T10:00:00.000Z',
      },
      trainer: {
        profileId: actorId,
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-01T10:00:00.000Z',
      },
    })
    expect(request.mock.calls.slice(1).every(([input]) => !requestUrl(input).includes(actorId)))
      .toBe(true)
  })

  it('rejects an incomplete trainer root instead of creating a partial Yandex profile', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input)
      if (url.endsWith('/auth/v1/user')) return Promise.resolve(Response.json({ id: actorId }))
      if (url.includes('/rest/v1/profiles?')) {
        return Promise.resolve(Response.json([{
          id: actorId,
          first_name: 'Fit',
          last_name: null,
          timezone: 'Europe/Moscow',
          account_role: 'trainer',
          created_at: '2026-08-01T10:00:00.000Z',
          updated_at: '2026-08-02T10:00:00.000Z',
        }]))
      }
      return Promise.resolve(Response.json([]))
    })

    await expect(new SupabaseExistingActorProvider(
      new SupabaseBridge(config, request),
    ).resolveActor('existing-session')).resolves.toBeUndefined()
  })
})
