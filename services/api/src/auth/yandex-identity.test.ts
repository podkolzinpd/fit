import { describe, expect, it, vi } from 'vitest'

import {
  readBearerToken,
  YandexIdentityClient,
  YandexIdentityRejectedError,
  YandexIdentityUnavailableError,
} from './yandex-identity.js'

const CLIENT_ID = 'fit-yandex-oauth-client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('YandexIdentityClient', () => {
  it('validates the OAuth app and hashes only the app-specific psuid', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'provider-user-id',
        psuid: 'app-specific-subject',
        client_id: CLIENT_ID,
        login: 'not-used',
      }),
    )
    const client = new YandexIdentityClient({
      expectedClientId: CLIENT_ID,
      fetchImplementation,
    })

    await expect(client.verifyAccessToken('oauth-access-token')).resolves.toEqual({
      subjectHash:
        '4f10b35249b40fa95e6d9299e88d6a92990bc5bcf62ab0cb2b19f3a348145095',
    })
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://login.yandex.ru/info?format=json',
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: 'OAuth oauth-access-token' },
        redirect: 'error',
      }),
    )
    expect(fetchImplementation.mock.calls[0]?.[0]).not.toContain(
      'oauth-access-token',
    )
  })

  it('rejects a token issued to another OAuth application', async () => {
    const client = new YandexIdentityClient({
      expectedClientId: CLIENT_ID,
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          id: 'provider-user-id',
          psuid: 'app-specific-subject',
          client_id: 'another-client',
        }),
      ),
    })

    await expect(client.verifyAccessToken('token')).rejects.toBeInstanceOf(
      YandexIdentityRejectedError,
    )
  })

  it('rejects invalid tokens without exposing an upstream response', async () => {
    const client = new YandexIdentityClient({
      expectedClientId: CLIENT_ID,
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ error: 'invalid_token' }, 401)),
    })

    await expect(client.verifyAccessToken('token')).rejects.toBeInstanceOf(
      YandexIdentityRejectedError,
    )
  })

  it('reports transient upstream failures separately from invalid identity', async () => {
    const client = new YandexIdentityClient({
      expectedClientId: CLIENT_ID,
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error('network details')),
    })

    await expect(client.verifyAccessToken('token')).rejects.toBeInstanceOf(
      YandexIdentityUnavailableError,
    )
  })
})

describe('readBearerToken', () => {
  it('accepts one bearer token and rejects ambiguous headers', () => {
    expect(readBearerToken('Bearer oauth-token')).toBe('oauth-token')
    expect(readBearerToken('OAuth oauth-token')).toBeUndefined()
    expect(readBearerToken('Bearer token with spaces')).toBeUndefined()
    expect(readBearerToken(undefined)).toBeUndefined()
  })
})
