const OAUTH_STATE_KEY = 'fit.yandexIdPilot.oauthState'
const OAUTH_VERIFIER_KEY = 'fit.yandexIdPilot.oauthVerifier'

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
): Promise<string> {
  const state = randomBase64Url(24)
  const verifier = randomBase64Url(64)
  storage.setItem(OAUTH_STATE_KEY, state)
  storage.setItem(OAUTH_VERIFIER_KEY, verifier)

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
}

export function consumeYandexAuthorizationCallback(
  search: string,
  storage: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage,
): YandexAuthorizationCode {
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  const expectedState = storage.getItem(OAUTH_STATE_KEY)
  const verifier = storage.getItem(OAUTH_VERIFIER_KEY)
  storage.removeItem(OAUTH_STATE_KEY)
  storage.removeItem(OAUTH_VERIFIER_KEY)

  if (params.get('error') !== null) throw new Error('Вход через Yandex ID был отменён или отклонён.')
  const returnedState = params.get('state')
  if (expectedState === null || returnedState === null || returnedState !== expectedState) {
    throw new Error('Не удалось безопасно подтвердить вход. Начните заново.')
  }
  const code = params.get('code')
  if (code === null || code.length === 0 || verifier === null || verifier.length === 0) {
    throw new Error('Yandex ID не вернул данные для входа. Начните заново.')
  }
  return { code, codeVerifier: verifier }
}
