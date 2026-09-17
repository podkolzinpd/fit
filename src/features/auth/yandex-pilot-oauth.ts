const OAUTH_STATE_KEY = 'fit.yandexIdPilot.oauthState'
const OAUTH_VERIFIER_KEY = 'fit.yandexIdPilot.oauthVerifier'
const OAUTH_INTENT_KEY = 'fit.yandexIdPilot.oauthIntent'
const NATIVE_REGISTRATION_KEY = 'fit.yandexIdPilot.nativeRegistration'
export type YandexAuthorizationIntent = 'pilot' | 'link' | 'app' | 'register'

export interface PendingYandexNativeRegistration {
  accountRole: 'trainer' | 'client'
  firstName: string
  timezone: string
  termsVersion: string
  privacyVersion: string
}

const LEGAL_VERSION_PATTERN = /^sha256:[0-9a-f]{24}$/

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function createYandexAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  storage: Pick<Storage, 'setItem'> = sessionStorage,
  intent: YandexAuthorizationIntent = 'pilot',
): Promise<string> {
  const state = randomBase64Url(24)
  const verifier = randomBase64Url(64)
  storage.setItem(OAUTH_STATE_KEY, state)
  storage.setItem(OAUTH_VERIFIER_KEY, verifier)
  storage.setItem(OAUTH_INTENT_KEY, intent)

  const url = new URL('https://oauth.yandex.ru/authorize')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', await codeChallenge(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('force_confirm', 'yes')
  return url.toString()
}

export interface YandexAuthorizationCode {
  code: string
  codeVerifier: string
  intent: YandexAuthorizationIntent
}

export function peekPendingYandexAuthorizationIntent(
  storage: Pick<Storage, 'getItem'> = sessionStorage,
): YandexAuthorizationIntent {
  const value = storage.getItem(OAUTH_INTENT_KEY)
  return value === 'link' || value === 'app' || value === 'register' ? value : 'pilot'
}

export function savePendingYandexNativeRegistration(
  registration: PendingYandexNativeRegistration,
  storage: Pick<Storage, 'setItem'> = sessionStorage,
): void {
  storage.setItem(NATIVE_REGISTRATION_KEY, JSON.stringify({
    accountRole: registration.accountRole,
    firstName: registration.firstName.trim(),
    timezone: registration.timezone.trim(),
    termsVersion: registration.termsVersion,
    privacyVersion: registration.privacyVersion,
  }))
}

export function readPendingYandexNativeRegistration(
  storage: Pick<Storage, 'getItem'> = sessionStorage,
): PendingYandexNativeRegistration | null {
  const raw = storage.getItem(NATIVE_REGISTRATION_KEY)
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (
      typeof value !== 'object'
      || value === null
      || !('accountRole' in value)
      || !('firstName' in value)
      || !('timezone' in value)
      || !('termsVersion' in value)
      || !('privacyVersion' in value)
      || (value.accountRole !== 'trainer' && value.accountRole !== 'client')
      || typeof value.firstName !== 'string'
      || value.firstName.trim().length < 2
      || value.firstName.trim().length > 120
      || typeof value.timezone !== 'string'
      || value.timezone.trim().length === 0
      || value.timezone.trim().length > 100
      || typeof value.termsVersion !== 'string'
      || !LEGAL_VERSION_PATTERN.test(value.termsVersion)
      || typeof value.privacyVersion !== 'string'
      || !LEGAL_VERSION_PATTERN.test(value.privacyVersion)
    ) return null
    return {
      accountRole: value.accountRole,
      firstName: value.firstName.trim(),
      timezone: value.timezone.trim(),
      termsVersion: value.termsVersion,
      privacyVersion: value.privacyVersion,
    }
  } catch {
    return null
  }
}

export function clearPendingYandexNativeRegistration(
  storage: Pick<Storage, 'removeItem'> = sessionStorage,
): void {
  storage.removeItem(NATIVE_REGISTRATION_KEY)
}

export function clearPendingYandexAuthorization(
  storage: Pick<Storage, 'removeItem'> = sessionStorage,
): void {
  storage.removeItem(OAUTH_STATE_KEY)
  storage.removeItem(OAUTH_VERIFIER_KEY)
  storage.removeItem(OAUTH_INTENT_KEY)
}

export function consumeYandexAuthorizationCallback(
  search: string,
  storage: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage,
): YandexAuthorizationCode {
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  const expectedState = storage.getItem(OAUTH_STATE_KEY)
  const verifier = storage.getItem(OAUTH_VERIFIER_KEY)
  const intent = peekPendingYandexAuthorizationIntent(storage)
  clearPendingYandexAuthorization(storage)

  if (params.get('error') !== null) throw new Error('Вход через Yandex ID был отменён или отклонён.')
  const returnedState = params.get('state')
  if (expectedState === null || returnedState === null || returnedState !== expectedState) {
    throw new Error('Не удалось безопасно подтвердить вход. Начните заново.')
  }
  const code = params.get('code')
  if (code === null || code.length === 0 || verifier === null || verifier.length === 0) {
    throw new Error('Yandex ID не вернул данные для входа. Начните заново.')
  }
  return { code, codeVerifier: verifier, intent }
}
