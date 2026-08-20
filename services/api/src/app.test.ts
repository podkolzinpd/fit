import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
import { buildApp } from './app.js'
import {
  YandexIdentityRejectedError,
  type YandexIdentityProvider,
  YandexIdentityUnavailableError,
} from './auth/yandex-identity.js'
import {
  YandexOAuthCodeRejectedError,
  type YandexOAuthCodeProvider,
} from './auth/yandex-oauth-code.js'
import {
  PilotAccessDeniedError,
  PilotSessionInvalidError,
} from './db/yandex-pilot-transaction.js'
import type { PilotClientsResponse } from './clients.js'
import type { PilotClientsReader } from './pilot-clients-reader.js'
import type { PilotProfileReader } from './pilot-profile-reader.js'
import type { PilotSessionIssuer, PilotSessionResponse } from './pilot-session.js'
import type { ProfileResponse } from './profile.js'

const apps: ReturnType<typeof buildApp>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('health endpoint', () => {
  it('reports that the API process is running', async () => {
    const app = buildApp({ logger: false })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })
})

describe('browser pilot CORS', () => {
  it('allows only an explicitly configured origin', async () => {
    const app = buildApp({ allowedOrigins: ['http://localhost:5173'], logger: false })
    apps.push(app)

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/profile',
      headers: { origin: 'http://localhost:5173' },
    })
    expect(preflight.statusCode).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(preflight.headers['access-control-allow-headers']).toContain('authorization')

    const rejected = await app.inject({
      method: 'OPTIONS',
      url: '/v1/profile',
      headers: { origin: 'https://attacker.example' },
    })
    expect(rejected.statusCode).toBe(403)
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined()

    const crossSiteRequest = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://attacker.example' },
    })
    expect(crossSiteRequest.statusCode).toBe(403)
  })
})

function buildDatabasePool(options: { connectFails?: boolean } = {}): {
  connection: DatabaseConnection
  pool: DatabasePool
  query: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
} {
  const query = vi.fn().mockResolvedValue([])
  const release = vi.fn()
  const connection: DatabaseConnection = {
    query,
    release,
  }
  const pool: DatabasePool = {
    connect: options.connectFails
      ? vi.fn().mockRejectedValue(new Error('connection failed'))
      : vi.fn().mockResolvedValue(connection),
    end: vi.fn().mockResolvedValue(undefined),
  }
  return { connection, pool, query, release }
}

describe('readiness endpoint', () => {
  it('reports ready only after a database query succeeds', async () => {
    const database = buildDatabasePool()
    const app = buildApp({ databasePool: database.pool, logger: false })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/ready' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ready' })
    expect(database.query).toHaveBeenCalledWith('select 1')
    expect(database.release).toHaveBeenCalledOnce()
  })

  it('stays unavailable when no database is configured', async () => {
    const app = buildApp({ logger: false })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/ready' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'not_ready' })
  })

  it('does not expose database connection errors', async () => {
    const database = buildDatabasePool({ connectFails: true })
    const app = buildApp({ databasePool: database.pool, logger: false })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/ready' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'not_ready' })
    expect(response.body).not.toContain('connection failed')
  })
})

const PROFILE_ID = 'a8e4d5cf-f021-4bfd-bd9e-62b1c30785c4'
const SUBJECT_HASH = 'a'.repeat(64)

function buildIdentityProvider(
  error?: YandexIdentityRejectedError | YandexIdentityUnavailableError,
): {
  identityProvider: YandexIdentityProvider
  verifyAccessToken: ReturnType<typeof vi.fn>
} {
  const verifyAccessToken = vi.fn(() =>
      error === undefined
        ? Promise.resolve({ subjectHash: SUBJECT_HASH })
        : Promise.reject(error),
    )
  return { identityProvider: { verifyAccessToken }, verifyAccessToken }
}

function buildOAuthCodeProvider(error?: YandexOAuthCodeRejectedError): {
  oauthCodeProvider: YandexOAuthCodeProvider
  exchangeCode: ReturnType<typeof vi.fn>
} {
  const exchangeCode = vi.fn(() => error === undefined
    ? Promise.resolve('temporary-yandex-token')
    : Promise.reject(error))
  return { oauthCodeProvider: { exchangeCode }, exchangeCode }
}

const PROFILE_RESPONSE: ProfileResponse = {
  accessMode: 'read_only',
  profile: {
    id: PROFILE_ID,
    firstName: 'Pilot',
    lastName: null,
    timezone: 'Europe/Moscow',
    accountRole: 'trainer',
  },
}

const SESSION_RESPONSE: PilotSessionResponse = {
  ...PROFILE_RESPONSE,
  session: {
    token: 's'.repeat(43),
    expiresAt: '2026-08-20T13:15:00.000Z',
  },
}

const CLIENTS_RESPONSE: PilotClientsResponse = {
  accessMode: 'read_only',
  clients: [{
    id: '1a0c5295-0a0f-4ccb-a39a-e58090967245',
    hasAccount: false,
    fullName: 'Тестовый клиент',
    canonicalFullName: 'Тестовый клиент',
    gender: null,
    ageYears: null,
    ageUpdatedAt: null,
    heightCm: null,
    goal: null,
    note: null,
    currentWeightKg: null,
    lastActivityAt: '2026-08-20T12:00:00.000Z',
    archivedAt: null,
    version: 1,
    membershipVersion: 1,
  }],
}

function buildProfileReader(
  result: ProfileResponse | undefined | Error = PROFILE_RESPONSE,
): {
  pilotProfileReader: PilotProfileReader
  readProfile: ReturnType<typeof vi.fn>
} {
  const readProfile = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  )
  return { pilotProfileReader: { readProfile }, readProfile }
}

function buildSessionIssuer(
  result: PilotSessionResponse | undefined | Error = SESSION_RESPONSE,
): {
  pilotSessionIssuer: PilotSessionIssuer
  issue: ReturnType<typeof vi.fn>
} {
  const issue = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  )
  return { pilotSessionIssuer: { issue }, issue }
}

function buildClientsReader(
  result: PilotClientsResponse | Error = CLIENTS_RESPONSE,
): {
  pilotClientsReader: PilotClientsReader
  readClients: ReturnType<typeof vi.fn>
} {
  const readClients = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  )
  return { pilotClientsReader: { readClients }, readClients }
}

describe('read-only Yandex profile endpoint', () => {
  it('requires a bearer token before calling Yandex ID', async () => {
    const identity = buildIdentityProvider()
    const profileReader = buildProfileReader()
    const app = buildApp({
      identityProvider: identity.identityProvider,
      pilotProfileReader: profileReader.pilotProfileReader,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/v1/profile' })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthorized' })
    expect(identity.verifyAccessToken).not.toHaveBeenCalled()
  })

  it('rejects an invalid Yandex identity with a generic response', async () => {
    const app = buildApp({
      identityProvider: buildIdentityProvider(new YandexIdentityRejectedError())
        .identityProvider,
      pilotProfileReader: buildProfileReader().pilotProfileReader,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: { authorization: 'Bearer rejected-token' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthorized' })
    expect(response.body).not.toContain('Yandex')
  })

  it('keeps non-allowlisted identities outside the pilot', async () => {
    const profileReader = buildProfileReader(new PilotAccessDeniedError())
    const app = buildApp({
      identityProvider: buildIdentityProvider().identityProvider,
      pilotProfileReader: profileReader.pilotProfileReader,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'pilot_access_denied' })
    expect(profileReader.readProfile).toHaveBeenCalledWith(SUBJECT_HASH)
  })

  it('returns only the allowlisted actor profile in read-only mode', async () => {
    const profileReader = buildProfileReader()
    const app = buildApp({
      identityProvider: buildIdentityProvider().identityProvider,
      pilotProfileReader: profileReader.pilotProfileReader,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(PROFILE_RESPONSE)
    expect(profileReader.readProfile).toHaveBeenCalledWith(SUBJECT_HASH)
  })

  it('does not turn a Yandex ID outage into an authentication rejection', async () => {
    const app = buildApp({
      identityProvider: buildIdentityProvider(
        new YandexIdentityUnavailableError(),
      ).identityProvider,
      pilotProfileReader: buildProfileReader().pilotProfileReader,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'service_unavailable' })
  })
})

describe('Yandex PKCE pilot callback', () => {
  it('exchanges a one-time code and returns an app session without exposing the Yandex token', async () => {
    const oauth = buildOAuthCodeProvider()
    const identity = buildIdentityProvider()
    const session = buildSessionIssuer()
    const app = buildApp({
      oauthCodeProvider: oauth.oauthCodeProvider,
      identityProvider: identity.identityProvider,
      pilotSessionIssuer: session.pilotSessionIssuer,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/yandex/pilot',
      payload: { code: 'one-time-code', codeVerifier: 'v'.repeat(43) },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(SESSION_RESPONSE)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).not.toContain('temporary-yandex-token')
    expect(oauth.exchangeCode).toHaveBeenCalledWith('one-time-code', 'v'.repeat(43))
    expect(identity.verifyAccessToken).toHaveBeenCalledWith('temporary-yandex-token')
    expect(session.issue).toHaveBeenCalledWith(SUBJECT_HASH)
  })

  it('rejects malformed input before contacting Yandex OAuth', async () => {
    const oauth = buildOAuthCodeProvider()
    const app = buildApp({ oauthCodeProvider: oauth.oauthCodeProvider, logger: false })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/yandex/pilot',
      payload: { code: 'one-time-code', codeVerifier: 'too-short' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(oauth.exchangeCode).not.toHaveBeenCalled()
  })

  it('does not expose a rejected authorization code', async () => {
    const oauth = buildOAuthCodeProvider(new YandexOAuthCodeRejectedError())
    const app = buildApp({
      oauthCodeProvider: oauth.oauthCodeProvider,
      identityProvider: buildIdentityProvider().identityProvider,
      pilotSessionIssuer: buildSessionIssuer().pilotSessionIssuer,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/yandex/pilot',
      payload: { code: 'rejected-code', codeVerifier: 'v'.repeat(43) },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthorized' })
    expect(response.body).not.toContain('rejected-code')
  })
})

describe('read-only pilot clients endpoint', () => {
  it('returns only clients resolved by the opaque pilot session', async () => {
    const clients = buildClientsReader()
    const app = buildApp({
      pilotClientsReader: clients.pilotClientsReader,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/clients',
      headers: { authorization: `Bearer ${'s'.repeat(43)}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(CLIENTS_RESPONSE)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(clients.readClients).toHaveBeenCalledWith('s'.repeat(43))
  })

  it('rejects a missing or expired pilot session', async () => {
    const clients = buildClientsReader(new PilotSessionInvalidError())
    const app = buildApp({
      pilotClientsReader: clients.pilotClientsReader,
      logger: false,
    })
    apps.push(app)

    const missing = await app.inject({ method: 'GET', url: '/v1/clients' })
    const expired = await app.inject({
      method: 'GET',
      url: '/v1/clients',
      headers: { authorization: `Bearer ${'x'.repeat(43)}` },
    })

    expect(missing.statusCode).toBe(401)
    expect(expired.statusCode).toBe(401)
    expect(expired.json()).toEqual({ error: 'unauthorized' })
  })
})
