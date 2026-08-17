import { describe, expect, it, vi } from 'vitest'
import {
  YandexOAuthCodeClient,
  YandexOAuthCodeRejectedError,
  YandexOAuthCodeUnavailableError,
} from './yandex-oauth-code.js'

describe('YandexOAuthCodeClient', () => {
  it('exchanges a PKCE code without a client secret', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'oauth-token' }), { status: 200 }))
    const client = new YandexOAuthCodeClient({ clientId: 'public-client-id', fetch: request })

    await expect(client.exchangeCode('one-time-code', 'pkce-verifier')).resolves.toBe('oauth-token')
    const [url, options] = request.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://oauth.yandex.ru/token')
    expect(options.body).toBeInstanceOf(URLSearchParams)
    const body = options.body as URLSearchParams
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('client_id')).toBe('public-client-id')
    expect(body.get('code_verifier')).toBe('pkce-verifier')
    expect(body.has('client_secret')).toBe(false)
  })

  it('separates rejected codes from provider outages', async () => {
    const rejected = new YandexOAuthCodeClient({
      clientId: 'public-client-id',
      fetch: vi.fn().mockResolvedValue(new Response('{}', { status: 400 })),
    })
    await expect(rejected.exchangeCode('bad-code', 'verifier')).rejects.toBeInstanceOf(YandexOAuthCodeRejectedError)

    const unavailable = new YandexOAuthCodeClient({
      clientId: 'public-client-id',
      fetch: vi.fn().mockRejectedValue(new Error('network error')),
    })
    await expect(unavailable.exchangeCode('code', 'verifier')).rejects.toBeInstanceOf(YandexOAuthCodeUnavailableError)
  })
})
