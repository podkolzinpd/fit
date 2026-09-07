import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumeYandexAuthorizationCallback,
  createYandexAuthorizationUrl,
  peekPendingYandexAuthorizationIntent,
} from './yandex-pilot-oauth'

const storage = new Map<string, string>()
const storageAdapter = {
  getItem: (key: string) => storage.get(key) ?? null,
  removeItem: (key: string) => storage.delete(key),
  setItem: (key: string, value: string) => storage.set(key, value),
}

describe('Yandex ID pilot OAuth', () => {
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(7),
      subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(9).buffer) },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('builds a PKCE authorization URL without a client secret', async () => {
    const result = new URL(await createYandexAuthorizationUrl(
      'public-client-id',
      'http://localhost:5173/auth/yandex/callback',
      storageAdapter,
    ))
    expect(result.origin + result.pathname).toBe('https://oauth.yandex.ru/authorize')
    expect(result.searchParams.get('response_type')).toBe('code')
    expect(result.searchParams.get('client_id')).toBe('public-client-id')
    expect(result.searchParams.get('redirect_uri')).toBe('http://localhost:5173/auth/yandex/callback')
    expect(result.searchParams.get('code_challenge_method')).toBe('S256')
    expect(result.searchParams.get('code_challenge')).not.toBe('')
    expect(result.searchParams.has('client_secret')).toBe(false)
  })

  it('returns the one-time code and verifier once when state matches', async () => {
    const authorizationUrl = new URL(await createYandexAuthorizationUrl(
      'public-client-id',
      'http://localhost:5173/auth/yandex/callback',
      storageAdapter,
    ))
    const state = authorizationUrl.searchParams.get('state')
    const result = consumeYandexAuthorizationCallback(`?code=oauth-code&state=${state}`, storageAdapter)
    expect(result.code).toBe('oauth-code')
    expect(result.codeVerifier.length).toBeGreaterThanOrEqual(43)
    expect(result.intent).toBe('pilot')
    expect(() => consumeYandexAuthorizationCallback(
      `?code=oauth-code&state=${state}`,
      storageAdapter,
    )).toThrow('Не удалось безопасно подтвердить вход')
  })

  it('marks account-linking authorization and consumes the intent with the verifier', async () => {
    const authorizationUrl = new URL(await createYandexAuthorizationUrl(
      'public-client-id',
      'http://localhost:5173/auth/yandex/callback',
      storageAdapter,
      'link',
    ))
    const state = authorizationUrl.searchParams.get('state')
    expect(peekPendingYandexAuthorizationIntent(storageAdapter)).toBe('link')

    const result = consumeYandexAuthorizationCallback(`?code=oauth-code&state=${state}`, storageAdapter)

    expect(result.intent).toBe('link')
    expect(peekPendingYandexAuthorizationIntent(storageAdapter)).toBe('pilot')
  })

  it('keeps the app-session intent separate from read-only pilot and linking', async () => {
    const authorizationUrl = new URL(await createYandexAuthorizationUrl(
      'public-client-id',
      'http://localhost:5173/auth/yandex/callback',
      storageAdapter,
      'app',
    ))
    const state = authorizationUrl.searchParams.get('state')
    expect(peekPendingYandexAuthorizationIntent(storageAdapter)).toBe('app')

    const result = consumeYandexAuthorizationCallback(`?code=oauth-code&state=${state}`, storageAdapter)

    expect(result.intent).toBe('app')
    expect(peekPendingYandexAuthorizationIntent(storageAdapter)).toBe('pilot')
  })

  it('rejects a mismatched state and OAuth errors', async () => {
    await createYandexAuthorizationUrl('public-client-id', 'http://localhost/callback', storageAdapter)
    expect(() => consumeYandexAuthorizationCallback(
      '?code=oauth-code&state=attacker-state',
      storageAdapter,
    )).toThrow('Не удалось безопасно подтвердить вход')

    await createYandexAuthorizationUrl('public-client-id', 'http://localhost/callback', storageAdapter)
    expect(() => consumeYandexAuthorizationCallback(
      '?error=access_denied&state=ignored',
      storageAdapter,
    )).toThrow('Вход через Yandex ID был отменён')
  })
})
