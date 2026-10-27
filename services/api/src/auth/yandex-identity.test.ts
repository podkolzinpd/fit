import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

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
  it('validates the OAuth app and separately hashes the subject and normalized login', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'provider-user-id',
        psuid: 'app-specific-subject',
        client_id: CLIENT_ID,
        login: ' Knyaz187@Mail.Ru ',
      }),
    )
    const client = new YandexIdentityClient({
      expectedClientId: CLIENT_ID,
      fetchImplementation,
    })

    await expect(client.verifyAccessToken('oauth-access-token')).resolves.toEqual({
      subjectHash:
        '4f10b35249b40fa95e6d9299e88d6a92990bc5bcf62ab0cb2b19f3a348145095',
      loginHash:
        '9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71',
      nutritionLoginHash:
        '9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71',
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

  it('uses the provider-verified underscore login exactly, never a different mailbox or shared hash normalization', async () => {
    const client = new YandexIdentityClient({ expectedClientId: CLIENT_ID,
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ id: 'synthetic-provider-id', psuid: 'synthetic-subject',
        client_id: CLIENT_ID, login: ' SYNTHETIC_CLIENT@YANDEX.RU ',
        default_email: 'synthetic-client@yandex.ru', emails: ['synthetic-client@yandex.ru'] })) })
    const hash = (value: string) => createHash('sha256').update(value).digest('hex')
    expect(await client.verifyAccessToken('synthetic-access-token')).toEqual({
      subjectHash: hash('synthetic-subject'), loginHash: hash('synthetic_client@yandex.ru'),
      nutritionLoginHash: hash('synthetic_client'),
    })
  })

  it('rejects a token issued to another OAuth application', async () => {
    const client = new YandexIdentityClient({
      expectedClientId: CLIENT_ID,
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          id: 'provider-user-id',
          psuid: 'app-specific-subject',
          client_id: 'another-client',
          login: 'person@example.test',
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
    await expect(client.verifyAccessToken('token')).rejects.toMatchObject({ failure: 'network' })
  })

  it.each([
    { response: () => new Response('private-upstream-body', { status: 502 }), failure: 'http', httpStatus: 502 },
    { response: () => new Response('private-invalid-json'), failure: 'invalid_response' },
  ])('preserves only safe $failure metadata from unavailable identity responses', async ({ response, failure, httpStatus }) => {
    const client = new YandexIdentityClient({ expectedClientId: CLIENT_ID,
      fetchImplementation: vi.fn().mockResolvedValue(response()) })
    await expect(client.verifyAccessToken('private-token')).rejects.toMatchObject({ failure, httpStatus })
    await expect(client.verifyAccessToken('private-token')).rejects.not.toThrow(/private-/)
  })
})

describe('Staff observer in verified OAuth login', () => {
  it('observes only the provider-verified login; ignores a different email and returns hashes only', async () => {
    const observe = vi.fn().mockResolvedValue(undefined)
    const client = new YandexIdentityClient({ expectedClientId: CLIENT_ID, employeeObserver: { observe },
      fetchImplementation: vi.fn().mockResolvedValue(jsonResponse({ id: 'synthetic-id', psuid: 'synthetic-subject',
        client_id: CLIENT_ID, login: 'synthetic.person', default_email: 'unrelated@example.test' })) })
    const identity = await client.verifyAccessToken('token')
    expect(observe).toHaveBeenCalledWith(identity.subjectHash, 'synthetic.person')
    expect(JSON.stringify(identity)).not.toMatch(/synthetic.person|unrelated/)
  })
  it('does not query Staff for a token issued to another application', async () => {
    const observe = vi.fn()
    const client = new YandexIdentityClient({ expectedClientId: CLIENT_ID, employeeObserver: { observe },
      fetchImplementation: vi.fn().mockResolvedValue(jsonResponse({ id: 'id', psuid: 'subject', client_id: 'wrong', login: 'synthetic.person' })) })
    await expect(client.verifyAccessToken('token')).rejects.toBeInstanceOf(YandexIdentityRejectedError)
    expect(observe).not.toHaveBeenCalled()
  })
  it('preserves normal login when the optional Staff observer fails', async () => {
    const client = new YandexIdentityClient({ expectedClientId: CLIENT_ID,
      employeeObserver: { observe: vi.fn().mockRejectedValue(new Error('private upstream details')) },
      fetchImplementation: vi.fn().mockResolvedValue(jsonResponse({ id: 'id', psuid: 'subject', client_id: CLIENT_ID, login: 'synthetic.person' })) })
    expect(await client.verifyAccessToken('token')).toHaveProperty('subjectHash')
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
