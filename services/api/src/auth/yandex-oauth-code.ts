export interface YandexOAuthCodeProvider {
  exchangeCode(code: string, codeVerifier: string): Promise<string>
}

export class YandexOAuthCodeRejectedError extends Error {
  constructor() {
    super('Yandex OAuth code was rejected')
    this.name = 'YandexOAuthCodeRejectedError'
  }
}

export class YandexOAuthCodeUnavailableError extends Error {
  constructor() {
    super('Yandex OAuth token service is unavailable')
    this.name = 'YandexOAuthCodeUnavailableError'
  }
}

interface YandexOAuthCodeClientOptions {
  clientId: string
  fetch?: typeof fetch
}

function readAccessToken(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('access_token' in value)) return undefined
  return typeof value.access_token === 'string' && value.access_token.length > 0
    ? value.access_token
    : undefined
}

export class YandexOAuthCodeClient implements YandexOAuthCodeProvider {
  private readonly clientId: string
  private readonly fetch: typeof fetch

  constructor(options: YandexOAuthCodeClientOptions) {
    this.clientId = options.clientId.trim()
    if (this.clientId.length === 0) throw new Error('Yandex OAuth client ID must not be empty')
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    let response: Response
    try {
      response = await this.fetch('https://oauth.yandex.ru/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: this.clientId,
          code_verifier: codeVerifier,
        }),
      })
    } catch {
      throw new YandexOAuthCodeUnavailableError()
    }
    if (response.status === 400 || response.status === 401) {
      throw new YandexOAuthCodeRejectedError()
    }
    if (!response.ok) throw new YandexOAuthCodeUnavailableError()

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new YandexOAuthCodeUnavailableError()
    }
    const token = readAccessToken(payload)
    if (token === undefined) throw new YandexOAuthCodeUnavailableError()
    return token
  }
}
