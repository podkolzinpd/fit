import { Capacitor } from '@capacitor/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { androidYandexCallbackPath } from './android-yandex-deep-link'
import { createYandexAuthorizationUrl } from './yandex-pilot-oauth'
import { yandexAuthorizationRedirectUri } from './yandex-redirect-uri'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Android Yandex OAuth return', () => {
  it('uses an app callback on Android and keeps the web callback on web', () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android')
    expect(yandexAuthorizationRedirectUri()).toBe('com.coachspace.fit://auth/yandex/callback')

    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web')
    vi.stubGlobal('window', { location: { origin: 'https://fit-training.ru' } })
    expect(yandexAuthorizationRedirectUri()).toBe('https://fit-training.ru/auth/yandex/callback')
  })

  it('returns only the expected callback with the pending PKCE state', async () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(7),
      subtle: { digest: () => Promise.resolve(new Uint8Array(32).buffer) },
    })
    const authorization = new URL(await createYandexAuthorizationUrl(
      'public-client-id',
      'com.coachspace.fit://auth/yandex/callback',
      storage,
    ))
    const state = authorization.searchParams.get('state')
    expect(androidYandexCallbackPath(`com.coachspace.fit://auth/yandex/callback?code=one-time&state=${state}`, storage))
      .toBe(`/auth/yandex/callback?code=one-time&state=${state}`)
    expect(androidYandexCallbackPath(`com.coachspace.fit://auth/yandex/callback?error=access_denied&state=${state}`, storage))
      .toBe(`/auth/yandex/callback?error=access_denied&state=${state}`)
    expect(androidYandexCallbackPath(`com.coachspace.fit://auth/yandex/callback?code=one-time&state=wrong`, storage)).toBeNull()
    expect(androidYandexCallbackPath(`com.coachspace.fit://other/yandex/callback?code=one-time&state=${state}`, storage)).toBeNull()
    expect(androidYandexCallbackPath(`https://fit-training.ru/auth/yandex/callback?code=one-time&state=${state}`, storage)).toBeNull()
  })
})
