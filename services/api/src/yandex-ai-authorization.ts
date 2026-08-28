const METADATA_TOKEN_URL =
  'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token'
const REFRESH_SKEW_MS = 60_000

export interface YandexAiAuthorization {
  authorizationHeader(): Promise<string>
}

interface MetadataTokenResponse {
  access_token?: unknown
  expires_in?: unknown
}

export class ApiKeyYandexAiAuthorization implements YandexAiAuthorization {
  constructor(private readonly apiKey: string) {
    if (apiKey.length === 0) throw new Error('Yandex Cloud API key must not be empty')
  }

  authorizationHeader(): Promise<string> {
    return Promise.resolve(`Api-Key ${this.apiKey}`)
  }
}

export class MetadataYandexAiAuthorization implements YandexAiAuthorization {
  private cached?: { header: string; refreshAt: number }
  private pending: Promise<string> | undefined

  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async authorizationHeader(): Promise<string> {
    if (this.cached !== undefined && this.now() < this.cached.refreshAt) {
      return this.cached.header
    }
    if (this.pending !== undefined) return this.pending

    this.pending = this.refresh().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private async refresh(): Promise<string> {
    const response = await this.request(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) throw new Error('Yandex Cloud metadata token is unavailable')

    const payload = await response.json() as MetadataTokenResponse
    if (
      typeof payload.access_token !== 'string'
      || payload.access_token.length === 0
      || typeof payload.expires_in !== 'number'
      || !Number.isFinite(payload.expires_in)
      || payload.expires_in <= 0
    ) {
      throw new Error('Yandex Cloud metadata token response is invalid')
    }

    const header = `Bearer ${payload.access_token}`
    this.cached = {
      header,
      refreshAt: this.now() + Math.max(0, payload.expires_in * 1_000 - REFRESH_SKEW_MS),
    }
    return header
  }
}

export function buildYandexAiAuthorization(
  environment: NodeJS.ProcessEnv = process.env,
): YandexAiAuthorization | undefined {
  if (environment.YANDEX_CLOUD_USE_METADATA_IAM_TOKEN === 'true') {
    return new MetadataYandexAiAuthorization()
  }
  const apiKey = environment.YANDEX_CLOUD_API_KEY
  if (apiKey !== undefined && apiKey.length > 0) {
    return new ApiKeyYandexAiAuthorization(apiKey)
  }
  return undefined
}
