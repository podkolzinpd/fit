import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
import { buildApp } from './app.js'
import {
  YandexIdentityRejectedError,
  type YandexIdentityProvider,
  YandexIdentityUnavailableError,
} from './auth/yandex-identity.js'
import { PilotAccessDeniedError } from './db/yandex-pilot-transaction.js'
import type { PilotProfileReader } from './pilot-profile-reader.js'
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
