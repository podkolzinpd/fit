import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
import type { PilotConnectionsResponse } from './connections.js'
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
import type { PilotConnectionsReader } from './pilot-connections-reader.js'
import type { PilotConnectionsWriter } from './pilot-connections-writer.js'
import { PilotConnectionCommandError } from './connection-commands.js'
import type { PilotProfileReader } from './pilot-profile-reader.js'
import type { PilotSessionIssuer, PilotSessionResponse } from './pilot-session.js'
import type { PilotTrainingDataReader } from './pilot-training-data-reader.js'
import type { ProfileResponse } from './profile.js'
import type { PilotTrainingDataResponse } from './training-data.js'

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
    expect(preflight.headers['access-control-allow-methods']).toContain('DELETE')
    expect(preflight.headers['access-control-allow-headers']).toContain('authorization')
    expect(preflight.headers['access-control-allow-headers']).toContain('x-fit-pilot-session')

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

const CONNECTIONS_RESPONSE: PilotConnectionsResponse = {
  accessMode: 'read_only',
  memberships: [{
    clientId: '1a0c5295-0a0f-4ccb-a39a-e58090967245',
    trainerId: PROFILE_ID,
    firstName: 'Pilot',
    lastName: null,
    joinedAt: '2026-08-20T12:00:00.000Z',
    isRoot: true,
  }],
  invitations: [{
    id: 'a978da50-1aac-4eac-8df1-42a517766ffe',
    clientId: '1a0c5295-0a0f-4ccb-a39a-e58090967245',
    targetRole: 'client',
    expiresAt: '2026-08-27T12:00:00.000Z',
    createdAt: '2026-08-20T12:00:00.000Z',
  }],
}

const TRAINING_DATA_RESPONSE: PilotTrainingDataResponse = {
  accessMode: 'read_only',
  customExercises: [{
    id: '8f3c305e-f206-40b3-a8f0-a8d8b3df34b9',
    name: 'Тяга саней',
    muscleGroup: 'legs',
    inputKind: 'strength',
    archivedAt: null,
    version: 1,
  }],
  workouts: [{
    id: 'be3b5576-1f5f-4db1-944b-cd78f06aa73b',
    trainerId: PROFILE_ID,
    clientId: CLIENTS_RESPONSE.clients[0]!.id,
    clientName: 'Тестовый клиент',
    createdBy: PROFILE_ID,
    workoutDate: '2026-08-20',
    startTime: '10:00:00',
    endTime: null,
    status: 'planned',
    notes: null,
    startedAt: null,
    completedAt: null,
    version: 1,
    exercises: [{
      id: '7e1bb6d7-7717-41ea-aea5-0d8d0ea50c35',
      position: 0,
      source: 'system',
      ref: 'running',
      customExerciseId: null,
      name: 'Бег',
      muscleGroup: 'cardio',
      inputKind: 'distance',
      blockId: '7d3b454b-933c-43a6-9331-ac4009644933',
      blockType: 'single',
      blockPreset: 'set',
      blockRounds: 1,
      restBetweenExercisesSec: 0,
      restBetweenRoundsSec: 90,
      restBetweenSetsSec: 90,
      trainerComment: null,
      sets: [{
        id: '5f2a3b76-c149-43f2-a7ab-290b2dfdcd11',
        position: 0,
        plan: {
          weightKg: null,
          reps: null,
          durationMin: null,
          durationSec: 1_800,
          distanceKm: 5,
          rpe: 7,
        },
        fact: {
          weightKg: null,
          reps: null,
          durationMin: null,
          durationSec: null,
          distanceKm: null,
          rpe: null,
        },
        confirmedAt: null,
        version: 1,
      }],
    }],
  }],
  hasMoreWorkouts: false,
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

function buildConnectionsReader(
  result: PilotConnectionsResponse | Error = CONNECTIONS_RESPONSE,
): {
  pilotConnectionsReader: PilotConnectionsReader
  readConnections: ReturnType<typeof vi.fn>
} {
  const readConnections = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  )
  return { pilotConnectionsReader: { readConnections }, readConnections }
}

function buildTrainingDataReader(
  result: PilotTrainingDataResponse | Error = TRAINING_DATA_RESPONSE,
): {
  pilotTrainingDataReader: PilotTrainingDataReader
  readTrainingData: ReturnType<typeof vi.fn>
} {
  const readTrainingData = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  )
  return { pilotTrainingDataReader: { readTrainingData }, readTrainingData }
}

function buildConnectionsWriter(error?: Error): {
  pilotConnectionsWriter: PilotConnectionsWriter
  claimInvitation: ReturnType<typeof vi.fn>
  createInvitation: ReturnType<typeof vi.fn>
  leaveClient: ReturnType<typeof vi.fn>
  removeTrainer: ReturnType<typeof vi.fn>
  revokeInvitation: ReturnType<typeof vi.fn>
} {
  const result = <Value>(value: Value) => error === undefined
    ? Promise.resolve(value)
    : Promise.reject(error)
  const claimInvitation = vi.fn(() => result(CLIENTS_RESPONSE.clients[0]!.id))
  const createInvitation = vi.fn(() => result({
    id: CONNECTIONS_RESPONSE.invitations[0]!.id,
    clientId: CLIENTS_RESPONSE.clients[0]!.id,
    targetRole: 'client' as const,
    code: 'ABCDEF123456',
    expiresAt: '2026-08-27T12:00:00.000Z',
  }))
  const leaveClient = vi.fn(() => result(undefined))
  const removeTrainer = vi.fn(() => result(undefined))
  const revokeInvitation = vi.fn(() => result(undefined))
  return {
    pilotConnectionsWriter: {
      claimInvitation,
      createInvitation,
      leaveClient,
      removeTrainer,
      revokeInvitation,
    },
    claimInvitation,
    createInvitation,
    leaveClient,
    removeTrainer,
    revokeInvitation,
  }
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
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
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
      headers: { 'x-fit-pilot-session': 'x'.repeat(43) },
    })
    const reservedAuthorizationHeader = await app.inject({
      method: 'GET',
      url: '/v1/clients',
      headers: { authorization: `Bearer ${'s'.repeat(43)}` },
    })

    expect(missing.statusCode).toBe(401)
    expect(expired.statusCode).toBe(401)
    expect(expired.json()).toEqual({ error: 'unauthorized' })
    expect(reservedAuthorizationHeader.statusCode).toBe(401)
  })
})

describe('read-only pilot connections endpoint', () => {
  it('returns memberships and only active invitations resolved by the session', async () => {
    const connections = buildConnectionsReader()
    const app = buildApp({
      pilotConnectionsReader: connections.pilotConnectionsReader,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/connections',
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(CONNECTIONS_RESPONSE)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(connections.readConnections).toHaveBeenCalledWith('s'.repeat(43))
  })

  it('rejects a missing or expired pilot session', async () => {
    const connections = buildConnectionsReader(new PilotSessionInvalidError())
    const app = buildApp({
      pilotConnectionsReader: connections.pilotConnectionsReader,
      logger: false,
    })
    apps.push(app)

    const missing = await app.inject({ method: 'GET', url: '/v1/connections' })
    const expired = await app.inject({
      method: 'GET',
      url: '/v1/connections',
      headers: { 'x-fit-pilot-session': 'x'.repeat(43) },
    })

    expect(missing.statusCode).toBe(401)
    expect(expired.statusCode).toBe(401)
    expect(expired.json()).toEqual({ error: 'unauthorized' })
  })
})

describe('read-only pilot training data endpoint', () => {
  it('returns the exercise and workout aggregate resolved by the session', async () => {
    const trainingData = buildTrainingDataReader()
    const app = buildApp({
      pilotTrainingDataReader: trainingData.pilotTrainingDataReader,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/training-data',
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(TRAINING_DATA_RESPONSE)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(trainingData.readTrainingData).toHaveBeenCalledWith('s'.repeat(43))
  })

  it('rejects a missing or expired pilot session', async () => {
    const trainingData = buildTrainingDataReader(new PilotSessionInvalidError())
    const app = buildApp({
      pilotTrainingDataReader: trainingData.pilotTrainingDataReader,
      logger: false,
    })
    apps.push(app)

    const missing = await app.inject({ method: 'GET', url: '/v1/training-data' })
    const expired = await app.inject({
      method: 'GET',
      url: '/v1/training-data',
      headers: { 'x-fit-pilot-session': 'x'.repeat(43) },
    })

    expect(missing.statusCode).toBe(401)
    expect(expired.statusCode).toBe(401)
    expect(expired.json()).toEqual({ error: 'unauthorized' })
  })
})

describe('pilot invitation and membership commands', () => {
  const sessionToken = 's'.repeat(43)
  const clientId = CLIENTS_RESPONSE.clients[0]!.id
  const invitationId = CONNECTIONS_RESPONSE.invitations[0]!.id

  it('creates and claims a single-use invitation without caching its code', async () => {
    const writer = buildConnectionsWriter()
    const app = buildApp({
      pilotConnectionsWriter: writer.pilotConnectionsWriter,
      logger: false,
    })
    apps.push(app)

    const created = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { clientId, targetRole: 'client' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.headers['cache-control']).toBe('no-store')
    expect(created.json()).toMatchObject({
      invitation: { clientId, code: 'ABCDEF123456' },
    })
    expect(writer.createInvitation).toHaveBeenCalledWith(
      sessionToken,
      clientId,
      'client',
    )

    const claimed = await app.inject({
      method: 'POST',
      url: '/v1/invitations/claim',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { code: 'abcdef123456' },
    })
    expect(claimed.statusCode).toBe(200)
    expect(claimed.headers['cache-control']).toBe('no-store')
    expect(claimed.json()).toEqual({ clientId })
    expect(writer.claimInvitation).toHaveBeenCalledWith(
      sessionToken,
      'ABCDEF123456',
    )
  })

  it('revokes, removes and leaves through explicit destructive endpoints', async () => {
    const writer = buildConnectionsWriter()
    const app = buildApp({
      pilotConnectionsWriter: writer.pilotConnectionsWriter,
      logger: false,
    })
    apps.push(app)

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/v1/invitations/${invitationId}`,
      headers: { 'x-fit-pilot-session': sessionToken },
    })
    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/clients/${clientId}/trainers/${PROFILE_ID}`,
      headers: { 'x-fit-pilot-session': sessionToken },
    })
    const left = await app.inject({
      method: 'DELETE',
      url: `/v1/clients/${clientId}/memberships/me`,
      headers: { 'x-fit-pilot-session': sessionToken },
    })

    expect([revoked.statusCode, removed.statusCode, left.statusCode]).toEqual([
      204,
      204,
      204,
    ])
    expect(writer.revokeInvitation).toHaveBeenCalledWith(sessionToken, invitationId)
    expect(writer.removeTrainer).toHaveBeenCalledWith(sessionToken, clientId, PROFILE_ID)
    expect(writer.leaveClient).toHaveBeenCalledWith(sessionToken, clientId)
  })

  it('validates identifiers and codes before calling the writer', async () => {
    const writer = buildConnectionsWriter()
    const app = buildApp({
      pilotConnectionsWriter: writer.pilotConnectionsWriter,
      logger: false,
    })
    apps.push(app)

    const invalidClient = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { clientId: 'not-a-uuid', targetRole: 'client' },
    })
    const invalidCode = await app.inject({
      method: 'POST',
      url: '/v1/invitations/claim',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { code: 'short' },
    })

    expect(invalidClient.statusCode).toBe(400)
    expect(invalidCode.statusCode).toBe(400)
    expect(writer.createInvitation).not.toHaveBeenCalled()
    expect(writer.claimInvitation).not.toHaveBeenCalled()
  })

  it.each([
    ['forbidden', 403, 'action_not_allowed'],
    ['not_found', 404, 'resource_not_found'],
    ['conflict', 409, 'conflict'],
    ['invalid', 422, 'action_not_allowed'],
  ] as const)('maps %s domain failures without exposing database details', async (
    failure,
    status,
    responseError,
  ) => {
    const writer = buildConnectionsWriter(new PilotConnectionCommandError(failure))
    const app = buildApp({
      pilotConnectionsWriter: writer.pilotConnectionsWriter,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/claim',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { code: 'ABCDEF123456' },
    })

    expect(response.statusCode).toBe(status)
    expect(response.json()).toEqual({ error: responseError })
    expect(response.body).not.toContain('Pilot connection command failed')
  })

  it('requires the opaque pilot session for every write', async () => {
    const writer = buildConnectionsWriter()
    const app = buildApp({
      pilotConnectionsWriter: writer.pilotConnectionsWriter,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/invitations/${invitationId}`,
    })

    expect(response.statusCode).toBe(401)
    expect(writer.revokeInvitation).not.toHaveBeenCalled()
  })
})
