import type { CorporateAdminLoginObserver } from '../corporate-admin-login.js'
import { createHash } from 'node:crypto'
import { nutritionLoginHash } from '../nutrition-pilot.js'

export interface VerifiedYandexIdentity {
  subjectHash: string
  loginHash?: string
  nutritionLoginHash?: string
}

export interface YandexIdentityProvider {
  verifyAccessToken(token: string): Promise<VerifiedYandexIdentity>
}

export class YandexIdentityRejectedError extends Error {
  constructor() {
    super('Yandex identity token was rejected')
    this.name = 'YandexIdentityRejectedError'
  }
}

export class YandexIdentityUnavailableError extends Error {
  constructor(
    readonly failure: 'network' | 'http' | 'invalid_response' | 'unknown' = 'unknown',
    readonly httpStatus?: number,
  ) {
    super('Yandex identity service is unavailable')
    this.name = 'YandexIdentityUnavailableError'
  }
}

interface YandexIdentityClientOptions {
  corporateAdminObserver?: CorporateAdminLoginObserver
  expectedClientId: string
  fetchImplementation?: typeof fetch
  timeoutMs?: number
}

function readRequiredString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

function parseIdentityPayload(value: unknown): {
  clientId: string
  psuid: string
  login: string
} | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }

  const payload = value as Record<string, unknown>
  const clientId = readRequiredString(payload, 'client_id')
  const psuid = readRequiredString(payload, 'psuid')
  const id = readRequiredString(payload, 'id')
  const login = readRequiredString(payload, 'login')
  if (
    clientId === undefined
    || psuid === undefined
    || id === undefined
    || login === undefined
  ) {
    return undefined
  }

  return { clientId, psuid, login }
}

export class YandexIdentityClient implements YandexIdentityProvider {
  private readonly corporateAdminObserver: CorporateAdminLoginObserver | undefined
  private readonly expectedClientId: string
  private readonly fetchImplementation: typeof fetch
  private readonly timeoutMs: number

  constructor(options: YandexIdentityClientOptions) {
    const expectedClientId = options.expectedClientId.trim()
    if (expectedClientId.length === 0) {
      throw new Error('Yandex OAuth client ID must not be empty')
    }

    this.corporateAdminObserver = options.corporateAdminObserver
    this.expectedClientId = expectedClientId
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 3_000
  }

  async verifyAccessToken(token: string): Promise<VerifiedYandexIdentity> {
    let response: Response
    try {
      response = await this.fetchImplementation(
        'https://login.yandex.ru/info?format=json',
        {
          method: 'GET',
          headers: { authorization: `OAuth ${token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      )
    } catch {
      throw new YandexIdentityUnavailableError('network')
    }

    if (response.status === 401 || response.status === 403) {
      throw new YandexIdentityRejectedError()
    }
    if (!response.ok) throw new YandexIdentityUnavailableError('http', response.status)

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new YandexIdentityUnavailableError('invalid_response')
    }

    const identity = parseIdentityPayload(payload)
    if (
      identity === undefined ||
      identity.clientId !== this.expectedClientId
    ) {
      throw new YandexIdentityRejectedError()
    }

    const subjectHash = createHash('sha256').update(identity.psuid, 'utf8').digest('hex')
    const loginHash = createHash('sha256').update(identity.login.trim().toLowerCase(), 'utf8').digest('hex')
    try { await this.corporateAdminObserver?.observe(subjectHash, loginHash) } catch {
      // Closed admin access must never prevent ordinary trainer/client sign-in.
    }
    return {
      ...(nutritionLoginHash(identity.login) === undefined ? {} : { nutritionLoginHash: nutritionLoginHash(identity.login)! }),
      subjectHash,
      loginHash,
    }
  }
}

export function readBearerToken(
  authorizationHeader: string | undefined,
): string | undefined {
  if (authorizationHeader === undefined) return undefined

  const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader)
  const token = match?.[1]
  if (token === undefined || token.length > 4_096) return undefined
  return token
}
