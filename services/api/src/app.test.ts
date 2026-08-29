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
import { PilotDomainCommandError } from './domain-commands.js'
import type {
  ClientCardDraft,
  CreateClientCardDraft,
  CustomExerciseDraft,
} from './domain-request.js'
import type { PilotDomainWriter } from './pilot-domain-writer.js'
import type { PilotProfileReader } from './pilot-profile-reader.js'
import type { PilotSessionIssuer, PilotSessionResponse } from './pilot-session.js'
import type { PilotTrainingDataReader } from './pilot-training-data-reader.js'
import type { PilotWorkoutsWriter } from './pilot-workouts-writer.js'
import type { PlannedWorkoutDraft } from './planned-workout-request.js'
import type { ProfileResponse } from './profile.js'
import type { PilotTrainingDataResponse } from './training-data.js'
import { PilotWorkoutCommandError } from './workout-commands.js'
import type { LegacyWorkoutParser } from './legacy-workout-parser.js'
import type { PilotProgressData } from './progress-data.js'
import type { PilotWorkoutParser } from './pilot-workout-parser.js'
import type { PilotTrainingSummaries } from './training-summary.js'

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

  it('reports the immutable release when the runtime provides it', async () => {
    const app = buildApp({ logger: false, releaseId: 'api-tree-hash' })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'ok',
      releaseId: 'api-tree-hash',
    })
    expect(response.headers['x-fit-release-id']).toBe('api-tree-hash')
  })
})

describe('legacy Supabase function bridge', () => {
  it('keeps the Supabase token out of the IAM Authorization header and returns the parser contract', async () => {
    const parse = vi.fn().mockResolvedValue({ items: [], unmatched: [] })
    const parser: LegacyWorkoutParser = { parse }
    const app = buildApp({ legacyWorkoutParser: parser, logger: false })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/legacy/parse-workout',
      headers: { 'x-supabase-authorization': 'Bearer supabase-access-token' },
      payload: { text: 'присед', systemCatalog: [] },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ items: [], unmatched: [] })
    expect(parse).toHaveBeenCalledWith('supabase-access-token', { text: 'присед', systemCatalog: [] })
  })

  it('dispatches goal criteria suggestions without changing the workout parser contract', async () => {
    const parse = vi.fn()
    const suggest = vi.fn().mockResolvedValue({ criteria: [], needsInput: [], unsupportedReason: 'Нужно уточнение' })
    const parser: LegacyWorkoutParser = { parse, suggest }
    const app = buildApp({ legacyWorkoutParser: parser, logger: false })
    apps.push(app)
    const payload = { kind: 'goal_criteria', text: 'Стать выносливее', systemCatalog: [] }

    const response = await app.inject({ method: 'POST', url: '/v1/legacy/parse-workout',
      headers: { 'x-supabase-authorization': 'Bearer supabase-access-token' }, payload })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ criteria: [], needsInput: [], unsupportedReason: 'Нужно уточнение' })
    expect(suggest).toHaveBeenCalledWith('supabase-access-token', payload)
    expect(parse).not.toHaveBeenCalled()
  })

  it('keeps manual goal setup available when the suggestion model is not configured', async () => {
    const parser: LegacyWorkoutParser = { parse: vi.fn() }
    const app = buildApp({ legacyWorkoutParser: parser, logger: false })
    apps.push(app)

    const response = await app.inject({ method: 'POST', url: '/v1/legacy/parse-workout',
      headers: { 'x-supabase-authorization': 'Bearer token' },
      payload: { kind: 'goal_criteria', text: '5 км', systemCatalog: [] } })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'service_unavailable' })
  })

  it('does not expose a bridge endpoint until its cloud secrets are configured', async () => {
    const app = buildApp({ logger: false })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/legacy/parse-workout',
      headers: { 'x-supabase-authorization': 'Bearer token' },
      payload: { text: 'присед', systemCatalog: [] },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'service_unavailable' })
  })

  it('forwards the legacy summary body and Supabase JWT without using Authorization at the cloud boundary', async () => {
    const handler = vi.fn(async (request: Request) => {
      expect(request.headers.get('authorization')).toBe('Bearer supabase-access-token')
      await expect(request.json()).resolves.toEqual({ client_id: PROFILE_ID, period_start: '2026-08-01', period_end: '2026-08-20', force: false })
      return new Response(JSON.stringify({ data: { id: 'summary-id' }, cached: false }), { headers: { 'content-type': 'application/json' } })
    })
    const app = buildApp({ legacySummaryHandler: handler, logger: false })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/legacy/summarize-client-training',
      headers: { 'x-supabase-authorization': 'Bearer supabase-access-token' },
      payload: { client_id: PROFILE_ID, period_start: '2026-08-01', period_end: '2026-08-20', force: false },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ data: { id: 'summary-id' }, cached: false })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('exposes the assistant progress endpoint as a validated read-only wrapper', async () => {
    const handler = vi.fn(async (request: Request) => {
      expect(request.headers.get('authorization')).toBe('Bearer supabase-access-token')
      await expect(request.json()).resolves.toEqual({ client_id: PROFILE_ID, period_start: '2026-08-01', period_end: '2026-08-20', force: false })
      return new Response(JSON.stringify({ data: { id: 'summary-id' }, cached: false }), { headers: { 'content-type': 'application/json' } })
    })
    const app = buildApp({ legacySummaryHandler: handler, logger: false })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/assistant/progress-summary',
      headers: { 'x-supabase-authorization': 'Bearer supabase-access-token' },
      payload: { client_id: PROFILE_ID, period_start: '2026-08-01', period_end: '2026-08-20' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ data: { id: 'summary-id' }, cached: false })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('rejects malformed assistant progress input before it reaches the summary tool', async () => {
    const handler = vi.fn()
    const app = buildApp({ legacySummaryHandler: handler, logger: false })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/assistant/progress-summary',
      headers: { 'x-supabase-authorization': 'Bearer supabase-access-token' },
      payload: { client_id: PROFILE_ID, period_start: '2026-08-20', period_end: '2026-08-01', force: 'yes' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_progress_request' })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('native Yandex function contracts', () => {
  it('authenticates workout parsing with the pilot session instead of Supabase', async () => {
    const parse = vi.fn().mockResolvedValue({ items: [], unmatched: [] })
    const pilotWorkoutParser: PilotWorkoutParser = { parse }
    const app = buildApp({ pilotWorkoutParser, logger: false })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/assistant/yandex/parse-workout',
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
      payload: { text: 'присед', systemCatalog: [] },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ items: [], unmatched: [] })
    expect(parse).toHaveBeenCalledWith('s'.repeat(43), {
      text: 'присед', systemCatalog: [],
    })
  })

  it('generates and lists a goal-aware summary through the pilot session', async () => {
    const generate = vi.fn().mockResolvedValue({
      data: { id: 'summary-id', generated_at: '2026-08-26T12:00:00.000Z' },
      cached: false,
    })
    const list = vi.fn().mockResolvedValue([{ id: 'summary-id' }])
    const pilotTrainingSummaries: PilotTrainingSummaries = { generate, list }
    const app = buildApp({
      pilotTrainingSummaryGenerator: pilotTrainingSummaries,
      pilotTrainingSummaryReader: pilotTrainingSummaries,
      logger: false,
    })
    apps.push(app)

    const generated = await app.inject({
      method: 'POST',
      url: `/v1/clients/${PROFILE_ID}/training-summaries/generate`,
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
      payload: {
        client_id: PROFILE_ID,
        period_start: '2026-08-01',
        period_end: '2026-08-26',
      },
    })
    const listed = await app.inject({
      method: 'GET',
      url: `/v1/clients/${PROFILE_ID}/training-summaries`,
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
    })

    expect(generated.statusCode).toBe(200)
    expect(generated.json()).toEqual({
      data: { id: 'summary-id', generated_at: '2026-08-26T12:00:00.000Z' },
      cached: false,
    })
    expect(generate).toHaveBeenCalledWith('s'.repeat(43), {
      clientId: PROFILE_ID,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-26',
      force: false,
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.json()).toEqual({ summaries: [{ id: 'summary-id' }] })
  })

  it('does not expose either native contract without a pilot session', async () => {
    const list = vi.fn()
    const pilotTrainingSummaries: PilotTrainingSummaries = {
      generate: vi.fn(), list,
    }
    const app = buildApp({ pilotTrainingSummaryReader: pilotTrainingSummaries, logger: false })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/clients/${PROFILE_ID}/training-summaries`,
    })

    expect(response.statusCode).toBe(401)
    expect(list).not.toHaveBeenCalled()
  })

  it('keeps stored summaries readable when AI generation is not configured', async () => {
    const list = vi.fn().mockResolvedValue([{ id: 'stored-summary' }])
    const app = buildApp({ pilotTrainingSummaryReader: { list }, logger: false })
    apps.push(app)

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/clients/${PROFILE_ID}/training-summaries`,
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
    })
    const generated = await app.inject({
      method: 'POST',
      url: `/v1/clients/${PROFILE_ID}/training-summaries/generate`,
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
      payload: {
        client_id: PROFILE_ID,
        period_start: '2026-08-01',
        period_end: '2026-08-26',
      },
    })

    expect(listed.statusCode).toBe(200)
    expect(listed.json()).toEqual({ summaries: [{ id: 'stored-summary' }] })
    expect(generated.statusCode).toBe(503)
    expect(generated.headers['x-fit-error-code'])
      .toBe('training_summary_generation_not_configured')
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
    expect(preflight.headers['access-control-allow-methods']).toContain('PUT')
    expect(preflight.headers['access-control-allow-headers']).toContain('authorization')
    expect(preflight.headers['access-control-allow-headers']).toContain('x-fit-pilot-session')
    expect(preflight.headers['access-control-expose-headers']).toContain('x-fit-release-id')
    expect(preflight.headers['access-control-expose-headers']).toContain('x-fit-error-code')

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

function buildDatabasePool(options: { connectError?: Error } = {}): {
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
    connect: options.connectError !== undefined
      ? vi.fn().mockRejectedValue(options.connectError)
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
    const connectionError = Object.assign(
      new Error('connection failed with private diagnostics'),
      { code: '28P01' },
    )
    const database = buildDatabasePool({ connectError: connectionError })
    const app = buildApp({ databasePool: database.pool, logger: false })
    apps.push(app)
    const warn = vi.spyOn(app.log, 'warn')

    const response = await app.inject({ method: 'GET', url: '/ready' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'not_ready' })
    expect(response.body).not.toContain('connection failed')
    expect(warn).toHaveBeenCalledWith(
      {
        databaseErrorCategory: 'authentication',
        databaseErrorCode: '28P01',
      },
      'Database readiness check failed',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private diagnostics')
  })

  it('does not log an arbitrary error code from a failed dependency', async () => {
    const connectionError = Object.assign(new Error('private diagnostics'), {
      code: 'unsafe\nvalue',
    })
    const database = buildDatabasePool({ connectError: connectionError })
    const app = buildApp({ databasePool: database.pool, logger: false })
    apps.push(app)
    const warn = vi.spyOn(app.log, 'warn')

    await app.inject({ method: 'GET', url: '/ready' })

    expect(warn).toHaveBeenCalledWith(
      {
        databaseErrorCategory: 'unknown',
        databaseErrorCode: 'unknown',
      },
      'Database readiness check failed',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('unsafe')
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
    activity: {
      doneCount: 1,
      completionPercent: 100,
      lastWorkoutDate: '2026-08-20',
      daysInWork: 0,
      needsAttention: false,
    },
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
    clientComment: null,
    sessionRpe: null,
    wellbeing: null,
    discomfort: null,
    feedbackSubmittedAt: null,
    trainerReaction: null,
    trainerReview: null,
    trainerReviewAuthorId: null,
    trainerReviewedAt: null,
    clientQuestion: null,
    clientQuestionAskedAt: null,
    clientQuestionResolvedAt: null,
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
  attention: [],
  attentionPreferences: [],
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

function buildProgressData(): {
  pilotProgressData: PilotProgressData
  readBundle: ReturnType<typeof vi.fn>
  saveProgress: ReturnType<typeof vi.fn>
} {
  const readBundle = vi.fn().mockResolvedValue({ entries: [], customMetrics: [], goal: null })
  const saveProgress = vi.fn().mockResolvedValue({ id: WORKOUT_ID, version: 1 })
  return { readBundle, saveProgress, pilotProgressData: {
    readBundle,
    readRegularity: vi.fn().mockResolvedValue([]),
    readRunning: vi.fn().mockResolvedValue([]),
    readExercise: vi.fn().mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 }),
    readChronicle: vi.fn().mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 }),
    saveProgress,
    deleteProgress: vi.fn().mockResolvedValue(2),
    saveMetric: vi.fn().mockResolvedValue({ id: WORKOUT_ID, archivedAt: null, version: 1 }),
    setMetricArchived: vi.fn().mockResolvedValue({ id: WORKOUT_ID, archivedAt: null, version: 2 }),
    saveGoal: vi.fn().mockResolvedValue({ id: WORKOUT_ID, version: 1 }),
    archiveGoal: vi.fn().mockResolvedValue(2),
    saveStage: vi.fn().mockResolvedValue({ id: WORKOUT_ID, version: 1 }),
    deleteStage: vi.fn().mockResolvedValue(undefined),
  } }
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

function buildDomainWriter(error?: Error): {
  pilotDomainWriter: PilotDomainWriter
  createClient: ReturnType<typeof vi.fn>
  createCustomExercise: ReturnType<typeof vi.fn>
  setClientArchived: ReturnType<typeof vi.fn>
  setCustomExerciseArchived: ReturnType<typeof vi.fn>
  updateClient: ReturnType<typeof vi.fn>
  updateClientPreferences: ReturnType<typeof vi.fn>
  updateCustomExercise: ReturnType<typeof vi.fn>
} {
  const result = <Value>(value: Value) => error === undefined
    ? Promise.resolve(value)
    : Promise.reject(error)
  const customExercise = {
    id: TRAINING_DATA_RESPONSE.customExercises[0]!.id,
    name: 'Тяга саней',
    muscleGroup: 'legs' as const,
    inputKind: 'strength' as const,
    archivedAt: null,
    version: 1,
  }
  const createClient = vi.fn(() => result({
    id: CLIENTS_RESPONSE.clients[0]!.id,
    version: 1,
    membershipVersion: 1,
  }))
  const updateClient = vi.fn(() => result(2))
  const setClientArchived = vi.fn(() => result(3))
  const updateClientPreferences = vi.fn(() => result(2))
  const createCustomExercise = vi.fn(() => result(customExercise))
  const updateCustomExercise = vi.fn(() => result({ ...customExercise, version: 2 }))
  const setCustomExerciseArchived = vi.fn(() => result({
    ...customExercise,
    archivedAt: '2026-08-24T12:00:00.000Z',
    version: 3,
  }))
  return {
    pilotDomainWriter: {
      createClient,
      createCustomExercise,
      setClientArchived,
      setCustomExerciseArchived,
      updateClient,
      updateClientPreferences,
      updateCustomExercise,
    },
    createClient,
    createCustomExercise,
    setClientArchived,
    setCustomExerciseArchived,
    updateClient,
    updateClientPreferences,
    updateCustomExercise,
  }
}

const WORKOUT_ID = '12acc6d6-7ca8-43cd-b124-b4224c917fae'
const WORKOUT_EXERCISE_ID = 'd40b742b-5d5b-41ab-91df-ed464414d034'
const WORKOUT_SET_ID = 'ea8efab5-0530-4660-9798-79901fcddfeb'
const WORKOUT_BLOCK_ID = '44c414cc-542b-4f29-a17f-b451e44fd778'
const OPERATION_IDS = {
  appendExercise: 'f516e6e8-c275-4ed5-9b5e-e40b7198bc0b',
  appendSet: '4afaf90b-a2ba-45dd-bf97-73c7098c2cca',
  comment: 'd9c05d5c-e868-40f2-8fab-df079adcfef7',
  start: '723fa5d1-d3f0-4daa-b080-8fd354b89b86',
  save: '305a5b42-8b8b-44a9-a1e3-7c188511b25f',
  confirm: '3c6c84f1-80e6-4ba5-94cc-550fca410dbd',
  finish: '65331570-913c-4faa-9771-4a60d7a5e9f0',
  removeSet: '2fdba3b8-f688-40c9-955b-f84173970d31',
  reorder: '20c4ab7a-1316-46bf-b5ce-699015a320e8',
  replace: '9761cf15-f83d-423a-a241-8d0bffefb4e0',
} as const

function buildWorkoutsWriter(error?: Error): {
  pilotWorkoutsWriter: PilotWorkoutsWriter
  appendLiveExercise: ReturnType<typeof vi.fn>
  appendLiveSet: ReturnType<typeof vi.fn>
  cancelPlanned: ReturnType<typeof vi.fn>
  confirmLiveSet: ReturnType<typeof vi.fn>
  deletePlanned: ReturnType<typeof vi.fn>
  deleteWorkout: ReturnType<typeof vi.fn>
  finishLive: ReturnType<typeof vi.fn>
  removeLiveSet: ReturnType<typeof vi.fn>
  reorderLiveBlock: ReturnType<typeof vi.fn>
  replaceLiveExercise: ReturnType<typeof vi.fn>
  recordPlannedResult: ReturnType<typeof vi.fn>
  reschedule: ReturnType<typeof vi.fn>
  saveCompleted: ReturnType<typeof vi.fn>
  saveLiveSet: ReturnType<typeof vi.fn>
  savePlanned: ReturnType<typeof vi.fn>
  setLiveExerciseComment: ReturnType<typeof vi.fn>
  setClientComment: ReturnType<typeof vi.fn>
  startLive: ReturnType<typeof vi.fn>
  submitFeedback: ReturnType<typeof vi.fn>
  setReview: ReturnType<typeof vi.fn>
  askQuestion: ReturnType<typeof vi.fn>
  answerQuestion: ReturnType<typeof vi.fn>
  resolveQuestion: ReturnType<typeof vi.fn>
  snoozeAttention: ReturnType<typeof vi.fn>
} {
  const result = <Value>(value: Value) => error === undefined
    ? Promise.resolve(value)
    : Promise.reject(error)
  const deletePlanned = vi.fn(() => result(3))
  const deleteWorkout = vi.fn(() => result(3))
  const cancelPlanned = vi.fn(() => result(2))
  const reschedule = vi.fn(() => result(3))
  const savePlanned = vi.fn(() => result({ id: WORKOUT_ID, version: 1 }))
  const saveCompleted = vi.fn(() => result({ id: WORKOUT_ID, version: 2 }))
  const recordPlannedResult = vi.fn(() => result({ id: WORKOUT_ID, version: 3 }))
  const setClientComment = vi.fn(() => result(4))
  const submitFeedback = vi.fn(() => result(5))
  const setReview = vi.fn(() => result(6))
  const askQuestion = vi.fn(() => result(7))
  const answerQuestion = vi.fn(() => result(8))
  const resolveQuestion = vi.fn(() => result(9))
  const snoozeAttention = vi.fn(() => result('2026-09-08T12:00:00.000Z'))
  const appendLiveExercise = vi.fn(() => result({
    resourceId: WORKOUT_EXERCISE_ID,
    version: 3,
    replayed: false,
  }))
  const appendLiveSet = vi.fn(() => result({
    resourceId: WORKOUT_SET_ID,
    version: 4,
    replayed: false,
  }))
  const startLive = vi.fn(() => result({ version: 2, replayed: false }))
  const saveLiveSet = vi.fn(() => result({ version: 2, replayed: false }))
  const confirmLiveSet = vi.fn(() => result({ version: 3, replayed: false }))
  const finishLive = vi.fn(() => result({ version: 3, replayed: false }))
  const removeLiveSet = vi.fn(() => result({
    resourceId: WORKOUT_SET_ID,
    version: 5,
    replayed: false,
  }))
  const reorderLiveBlock = vi.fn(() => result({
    resourceId: WORKOUT_BLOCK_ID,
    version: 6,
    replayed: false,
  }))
  const replaceLiveExercise = vi.fn(() => result({
    resourceId: WORKOUT_EXERCISE_ID,
    version: 7,
    replayed: false,
  }))
  const setLiveExerciseComment = vi.fn(() => result({
    resourceId: WORKOUT_EXERCISE_ID,
    version: 8,
    replayed: false,
  }))
  return {
    pilotWorkoutsWriter: {
      submitFeedback,
      setReview,
      askQuestion,
      answerQuestion,
      resolveQuestion,
      snoozeAttention,
      appendLiveExercise,
      appendLiveSet,
      cancelPlanned,
      confirmLiveSet,
      deletePlanned,
      deleteWorkout,
      finishLive,
      removeLiveSet,
      reorderLiveBlock,
      replaceLiveExercise,
      recordPlannedResult,
      reschedule,
      saveCompleted,
      saveLiveSet,
      savePlanned,
      setLiveExerciseComment,
      setClientComment,
      startLive,
    },
    appendLiveExercise,
    appendLiveSet,
    cancelPlanned,
    confirmLiveSet,
    deletePlanned,
    deleteWorkout,
    finishLive,
    removeLiveSet,
    reorderLiveBlock,
    replaceLiveExercise,
    recordPlannedResult,
    reschedule,
    saveCompleted,
    saveLiveSet,
    savePlanned,
    setLiveExerciseComment,
    setClientComment,
    startLive,
    submitFeedback,
    setReview,
    askQuestion,
    answerQuestion,
    resolveQuestion,
    snoozeAttention,
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
    expect(clients.readClients).toHaveBeenCalledWith('s'.repeat(43), false)
  })

  it('selects archived clients explicitly so they can be restored', async () => {
    const clients = buildClientsReader()
    const app = buildApp({ pilotClientsReader: clients.pilotClientsReader, logger: false })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/clients?archived=true',
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
    })

    expect(response.statusCode).toBe(200)
    expect(clients.readClients).toHaveBeenCalledWith('s'.repeat(43), true)
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

  it('logs only safe diagnostics when the clients query fails', async () => {
    const databaseError = Object.assign(
      new Error('private client data and database connection details'),
      { code: '42501' },
    )
    const clients = buildClientsReader(databaseError)
    const app = buildApp({ pilotClientsReader: clients.pilotClientsReader, logger: false })
    apps.push(app)
    const warn = vi.spyOn(app.log, 'warn')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/clients',
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'service_unavailable' })
    expect(response.headers['x-fit-error-category']).toBe('permission')
    expect(response.headers['x-fit-error-code']).toBe('42501')
    expect(warn).toHaveBeenCalledWith(
      {
        databaseErrorCategory: 'permission',
        databaseErrorCode: '42501',
      },
      'Pilot clients query failed',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private client data')
    expect(response.body).not.toContain('42501')
  })

  it('does not log an arbitrary clients-query error code', async () => {
    const databaseError = Object.assign(new Error('private diagnostics'), {
      code: 'unsafe\nvalue',
    })
    const clients = buildClientsReader(databaseError)
    const app = buildApp({ pilotClientsReader: clients.pilotClientsReader, logger: false })
    apps.push(app)
    const warn = vi.spyOn(app.log, 'warn')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/clients',
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
    })

    expect(warn).toHaveBeenCalledWith(
      {
        databaseErrorCategory: 'unknown',
        databaseErrorCode: 'unknown',
      },
      'Pilot clients query failed',
    )
    expect(response.headers['x-fit-error-category']).toBe('unknown')
    expect(response.headers['x-fit-error-code']).toBe('unknown')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('unsafe')
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

  it('returns and logs only safe diagnostics when the connections query fails', async () => {
    const databaseError = Object.assign(
      new Error('private invitation and database connection details'),
      { code: '42501' },
    )
    const connections = buildConnectionsReader(databaseError)
    const app = buildApp({
      pilotConnectionsReader: connections.pilotConnectionsReader,
      logger: false,
    })
    apps.push(app)
    const warn = vi.spyOn(app.log, 'warn')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/connections',
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'service_unavailable' })
    expect(response.headers['x-fit-error-category']).toBe('permission')
    expect(response.headers['x-fit-error-code']).toBe('42501')
    expect(warn).toHaveBeenCalledWith(
      {
        databaseErrorCategory: 'permission',
        databaseErrorCode: '42501',
      },
      'Pilot connections query failed',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private invitation')
    expect(response.body).not.toContain('42501')
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

  it('returns and logs only safe diagnostics when training data fails', async () => {
    const databaseError = Object.assign(
      new Error('private workout and database connection details'),
      { code: '42501' },
    )
    const trainingData = buildTrainingDataReader(databaseError)
    const app = buildApp({
      pilotTrainingDataReader: trainingData.pilotTrainingDataReader,
      logger: false,
    })
    apps.push(app)
    const warn = vi.spyOn(app.log, 'warn')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/training-data',
      headers: { 'x-fit-pilot-session': 's'.repeat(43) },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'service_unavailable' })
    expect(response.headers['x-fit-error-category']).toBe('permission')
    expect(response.headers['x-fit-error-code']).toBe('42501')
    expect(warn).toHaveBeenCalledWith(
      {
        databaseErrorCategory: 'permission',
        databaseErrorCode: '42501',
      },
      'Pilot training data query failed',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private workout')
    expect(response.body).not.toContain('42501')
  })
})

describe('pilot progress and goals endpoints', () => {
  const sessionToken = 's'.repeat(43)
  const clientId = CLIENTS_RESPONSE.clients[0]!.id

  it('identifies a missing progress dependency without exposing runtime details', async () => {
    const app = buildApp({ logger: false, releaseId: 'candidate-release' })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/clients/${clientId}/progress`,
      headers: { 'x-fit-pilot-session': sessionToken },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'service_unavailable' })
    expect(response.headers['x-fit-error-category']).toBe('configuration')
    expect(response.headers['x-fit-error-code'])
      .toBe('PILOT_PROGRESS_DATA_UNAVAILABLE')
    expect(response.headers['x-fit-release-id']).toBe('candidate-release')
  })

  it('returns the shared progress bundle and creates a validated atomic entry', async () => {
    const progress = buildProgressData()
    const app = buildApp({ pilotProgressData: progress.pilotProgressData, logger: false })
    apps.push(app)

    const read = await app.inject({
      method: 'GET',
      url: `/v1/clients/${clientId}/progress`,
      headers: { 'x-fit-pilot-session': sessionToken },
    })
    const created = await app.inject({
      method: 'POST',
      url: '/v1/progress',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { draft: {
        clientId, recordedOn: '2026-08-25', weightKg: 70,
        customMetrics: [],
      } },
    })

    expect(read.statusCode).toBe(200)
    expect(read.json()).toEqual({ entries: [], customMetrics: [], goal: null })
    expect(progress.readBundle).toHaveBeenCalledWith(sessionToken, clientId)
    expect(created.statusCode).toBe(201)
    expect(progress.saveProgress).toHaveBeenCalledWith(sessionToken, {
      id: null, clientId, recordedOn: '2026-08-25', weightKg: 70,
      chestCm: null, waistCm: null, hipCm: null, notes: null, customMetrics: [],
    }, null)
  })

  it('rejects incomplete cursors and malformed writes before the database', async () => {
    const progress = buildProgressData()
    const app = buildApp({ pilotProgressData: progress.pilotProgressData, logger: false })
    apps.push(app)

    const cursor = await app.inject({
      method: 'GET',
      url: `/v1/clients/${clientId}/workout-chronicle?beforeCompletedAt=2026-08-25T10:00:00Z`,
      headers: { 'x-fit-pilot-session': sessionToken },
    })
    const write = await app.inject({
      method: 'POST', url: '/v1/progress',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { draft: { clientId, recordedOn: 'not-a-date', customMetrics: [] } },
    })

    expect(cursor.statusCode).toBe(400)
    expect(write.statusCode).toBe(400)
    expect(progress.saveProgress).not.toHaveBeenCalled()
  })

  it('returns only safe diagnostics for an unexpected domain command failure', async () => {
    const databaseError = Object.assign(
      new Error('private progress and connection details'),
      { code: '42501' },
    )
    const progress = buildProgressData()
    progress.readBundle.mockRejectedValue(databaseError)
    const app = buildApp({ pilotProgressData: progress.pilotProgressData, logger: false })
    apps.push(app)
    const warn = vi.spyOn(app.log, 'warn')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/clients/${clientId}/progress`,
      headers: { 'x-fit-pilot-session': sessionToken },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'service_unavailable' })
    expect(response.headers['x-fit-error-category']).toBe('permission')
    expect(response.headers['x-fit-error-code']).toBe('42501')
    expect(warn).toHaveBeenCalledWith(
      {
        databaseErrorCategory: 'permission',
        databaseErrorCode: '42501',
      },
      'Pilot command failed',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private progress')
    expect(response.body).not.toContain('42501')
  })
})

describe('pilot client and custom exercise domain commands', () => {
  const sessionToken = 's'.repeat(43)
  const clientId = CLIENTS_RESPONSE.clients[0]!.id
  const exerciseId = TRAINING_DATA_RESPONSE.customExercises[0]!.id
  const clientCardDraft: ClientCardDraft = {
    fullName: 'Новый клиент',
    gender: 'female',
    ageYears: 31,
    ageUpdatedAt: '2026-08-24',
    heightCm: 168,
    goal: 'Подготовиться к старту',
  }
  const clientDraft: CreateClientCardDraft = {
    ...clientCardDraft,
    note: 'Предпочитает утренние тренировки',
  }
  const exerciseDraft: CustomExerciseDraft = {
    name: 'Тяга саней',
    muscleGroup: 'legs',
    inputKind: 'strength',
  }

  it('creates, updates and archives a client with separate private preferences', async () => {
    const writer = buildDomainWriter()
    const app = buildApp({ pilotDomainWriter: writer.pilotDomainWriter, logger: false })
    apps.push(app)

    const created = await app.inject({
      method: 'POST', url: '/v1/clients',
      headers: { 'x-fit-pilot-session': sessionToken }, payload: clientDraft,
    })
    const updated = await app.inject({
      method: 'PUT', url: `/v1/clients/${clientId}`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { draft: clientCardDraft, expectedVersion: 1 },
    })
    const preferences = await app.inject({
      method: 'PUT', url: `/v1/clients/${clientId}/preferences`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { alias: 'Лена', note: 'Только для тренера', expectedVersion: 1 },
    })
    const archived = await app.inject({
      method: 'PUT', url: `/v1/clients/${clientId}/archive`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { archived: true, expectedVersion: 2 },
    })
    const restored = await app.inject({
      method: 'PUT', url: `/v1/clients/${clientId}/archive`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { archived: false, expectedVersion: 3 },
    })

    expect([
      created.statusCode, updated.statusCode, preferences.statusCode,
      archived.statusCode, restored.statusCode,
    ]).toEqual([201, 200, 200, 200, 200])
    expect(created.headers['cache-control']).toBe('no-store')
    expect(writer.createClient).toHaveBeenCalledWith(sessionToken, clientDraft)
    expect(writer.updateClient).toHaveBeenCalledWith(
      sessionToken, clientId, clientCardDraft, 1,
    )
    expect(writer.updateClientPreferences).toHaveBeenCalledWith(
      sessionToken, clientId, 'Лена', 'Только для тренера', 1,
    )
    expect(writer.setClientArchived).toHaveBeenCalledWith(sessionToken, clientId, true, 2)
    expect(writer.setClientArchived).toHaveBeenCalledWith(sessionToken, clientId, false, 3)
  })

  it('creates, updates and archives a trainer-owned custom exercise', async () => {
    const writer = buildDomainWriter()
    const app = buildApp({ pilotDomainWriter: writer.pilotDomainWriter, logger: false })
    apps.push(app)

    const created = await app.inject({
      method: 'POST', url: '/v1/custom-exercises',
      headers: { 'x-fit-pilot-session': sessionToken }, payload: exerciseDraft,
    })
    const updated = await app.inject({
      method: 'PUT', url: `/v1/custom-exercises/${exerciseId}`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { draft: exerciseDraft, expectedVersion: 1 },
    })
    const archived = await app.inject({
      method: 'PUT', url: `/v1/custom-exercises/${exerciseId}/archive`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { archived: true, expectedVersion: 2 },
    })
    const restored = await app.inject({
      method: 'PUT', url: `/v1/custom-exercises/${exerciseId}/archive`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { archived: false, expectedVersion: 3 },
    })

    expect([created.statusCode, updated.statusCode, archived.statusCode, restored.statusCode])
      .toEqual([201, 200, 200, 200])
    expect(writer.createCustomExercise).toHaveBeenCalledWith(sessionToken, exerciseDraft)
    expect(writer.updateCustomExercise).toHaveBeenCalledWith(
      sessionToken, exerciseId, exerciseDraft, 1,
    )
    expect(writer.setCustomExerciseArchived).toHaveBeenCalledWith(
      sessionToken, exerciseId, true, 2,
    )
    expect(writer.setCustomExerciseArchived).toHaveBeenCalledWith(
      sessionToken, exerciseId, false, 3,
    )
  })

  it('rejects malformed domain commands before invoking the writer', async () => {
    const writer = buildDomainWriter()
    const app = buildApp({ pilotDomainWriter: writer.pilotDomainWriter, logger: false })
    apps.push(app)

    const client = await app.inject({
      method: 'POST', url: '/v1/clients',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { ...clientDraft, fullName: ' ' },
    })
    const exercise = await app.inject({
      method: 'PUT', url: '/v1/custom-exercises/not-a-uuid',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { draft: exerciseDraft, expectedVersion: 1 },
    })

    expect([client.statusCode, exercise.statusCode]).toEqual([400, 400])
    expect(writer.createClient).not.toHaveBeenCalled()
    expect(writer.updateCustomExercise).not.toHaveBeenCalled()
  })

  it.each([
    ['forbidden', 403, 'action_not_allowed'],
    ['not_found', 404, 'resource_not_found'],
    ['conflict', 409, 'version_conflict'],
    ['invalid', 422, 'invalid_domain_data'],
  ] as const)('maps %s domain failures without exposing database details', async (
    failure, status, responseError,
  ) => {
    const writer = buildDomainWriter(new PilotDomainCommandError(failure))
    const app = buildApp({ pilotDomainWriter: writer.pilotDomainWriter, logger: false })
    apps.push(app)

    const response = await app.inject({
      method: 'POST', url: '/v1/custom-exercises',
      headers: { 'x-fit-pilot-session': sessionToken }, payload: exerciseDraft,
    })

    expect(response.statusCode).toBe(status)
    expect(response.json()).toEqual({ error: responseError })
    expect(response.body).not.toContain('Pilot domain command failed')
  })
})

describe('pilot planned workout commands', () => {
  const sessionToken = 's'.repeat(43)
  const clientId = CLIENTS_RESPONSE.clients[0]!.id
  const draft = {
    clientId,
    workoutDate: '2026-08-25',
    startTime: '10:00',
    endTime: '11:00',
    notes: 'План на вторник',
    exercises: [],
  }

  it('creates, updates and soft-deletes with explicit versions', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const created = await app.inject({
      method: 'POST',
      url: '/v1/workouts',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: draft,
    })
    const updated = await app.inject({
      method: 'PUT',
      url: `/v1/workouts/${WORKOUT_ID}`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { ...draft, notes: 'Обновлённый план', expectedVersion: 1 },
    })
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/workouts/${WORKOUT_ID}`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { expectedVersion: 2 },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toEqual({ workout: { id: WORKOUT_ID, version: 1 } })
    expect(updated.statusCode).toBe(200)
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toEqual({ workout: { id: WORKOUT_ID, version: 3 } })
    expect(created.headers['cache-control']).toBe('no-store')
    expect(writer.savePlanned).toHaveBeenNthCalledWith(
      1,
      sessionToken,
      { ...draft, id: null } satisfies PlannedWorkoutDraft,
      null,
    )
    expect(writer.savePlanned).toHaveBeenNthCalledWith(
      2,
      sessionToken,
      { ...draft, id: WORKOUT_ID, notes: 'Обновлённый план' } satisfies PlannedWorkoutDraft,
      1,
    )
    expect(writer.deleteWorkout).toHaveBeenCalledWith(
      sessionToken,
      WORKOUT_ID,
      2,
    )
  })

  it('rejects malformed aggregates before calling the writer', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/workouts',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { ...draft, workoutDate: '25.08.2026' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(writer.savePlanned).not.toHaveBeenCalled()
  })

  it.each([
    ['active', 409, 'active_workout_exists'],
    ['forbidden', 403, 'action_not_allowed'],
    ['not_found', 404, 'resource_not_found'],
    ['conflict', 409, 'version_conflict'],
    ['invalid', 422, 'invalid_workout'],
  ] as const)('maps %s failures without exposing database details', async (
    failure,
    status,
    responseError,
  ) => {
    const writer = buildWorkoutsWriter(new PilotWorkoutCommandError(failure))
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/workouts/${WORKOUT_ID}`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { ...draft, expectedVersion: 1 },
    })

    expect(response.statusCode).toBe(status)
    expect(response.json()).toEqual({ error: responseError })
    expect(response.body).not.toContain('Pilot workout command failed')
  })

  it('requires the opaque pilot session for every workout write', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/workouts/${WORKOUT_ID}`,
      payload: { expectedVersion: 1 },
    })

    expect(response.statusCode).toBe(401)
    expect(writer.deleteWorkout).not.toHaveBeenCalled()
  })
})

describe('pilot completed workout lifecycle commands', () => {
  const sessionToken = 's'.repeat(43)
  const clientId = CLIENTS_RESPONSE.clients[0]!.id
  const requestId = 'd0807ffc-0826-4d5e-a70d-56ffcb6c5a0c'
  const draft = {
    clientId,
    requestId,
    workoutDate: '2026-08-20',
    startTime: null,
    endTime: null,
    notes: 'Фактическая тренировка',
    exercises: [],
  }

  it('creates, edits and records completed facts without Live', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const created = await app.inject({
      method: 'POST',
      url: '/v1/workouts/completed',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: draft,
    })
    const updated = await app.inject({
      method: 'PUT',
      url: `/v1/workouts/${WORKOUT_ID}/completed`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { ...draft, expectedVersion: 2 },
    })
    const recorded = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/result`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { ...draft, expectedVersion: 1 },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toEqual({ workout: { id: WORKOUT_ID, version: 2 } })
    expect(updated.statusCode).toBe(200)
    expect(recorded.statusCode).toBe(200)
    expect(writer.saveCompleted).toHaveBeenNthCalledWith(
      1,
      sessionToken,
      { ...draft, id: null } satisfies PlannedWorkoutDraft,
      null,
    )
    expect(writer.saveCompleted).toHaveBeenNthCalledWith(
      2,
      sessionToken,
      { ...draft, id: WORKOUT_ID } satisfies PlannedWorkoutDraft,
      2,
    )
    expect(writer.recordPlannedResult).toHaveBeenCalledWith(
      sessionToken,
      { ...draft, id: WORKOUT_ID } satisfies PlannedWorkoutDraft,
      1,
    )
  })

  it('cancels, reschedules and stores the client comment with versions', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/cancel`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { expectedVersion: 1 },
    })
    const rescheduled = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/reschedule`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: {
        expectedVersion: 2,
        workoutDate: '2026-08-30',
        startTime: '12:30',
      },
    })
    const commented = await app.inject({
      method: 'PUT',
      url: `/v1/workouts/${WORKOUT_ID}/comment`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { expectedVersion: 3, comment: '  Было тяжело  ' },
    })

    expect([cancelled.statusCode, rescheduled.statusCode, commented.statusCode])
      .toEqual([200, 200, 200])
    expect(writer.cancelPlanned).toHaveBeenCalledWith(
      sessionToken, WORKOUT_ID, 1,
    )
    expect(writer.reschedule).toHaveBeenCalledWith(
      sessionToken, WORKOUT_ID, '2026-08-30', '12:30', 2,
    )
    expect(writer.setClientComment).toHaveBeenCalledWith(
      sessionToken, WORKOUT_ID, 'Было тяжело', 3,
    )
  })

  it('rejects malformed lifecycle commands before invoking the writer', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const rescheduled = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/reschedule`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { expectedVersion: 1, workoutDate: 'tomorrow' },
    })
    const commented = await app.inject({
      method: 'PUT',
      url: `/v1/workouts/${WORKOUT_ID}/comment`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { expectedVersion: 1, comment: 'a'.repeat(5_001) },
    })

    expect([rescheduled.statusCode, commented.statusCode]).toEqual([400, 400])
    expect(writer.reschedule).not.toHaveBeenCalled()
    expect(writer.setClientComment).not.toHaveBeenCalled()
  })
})

describe('pilot post-workout commands', () => {
  const sessionToken = 's'.repeat(43)

  it('validates and forwards feedback, responses, questions and snooze', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const feedback = await app.inject({
      method: 'PUT',
      url: `/v1/workouts/${WORKOUT_ID}/feedback`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: {
        sessionRpe: 8, wellbeing: 'normal', discomfort: true,
        comment: '  Тянуло плечо  ', expectedVersion: 1,
      },
    })
    const review = await app.inject({
      method: 'PUT',
      url: `/v1/workouts/${WORKOUT_ID}/review`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { reaction: 'strong', review: ' Отличная работа ', expectedVersion: 2 },
    })
    const question = await app.inject({
      method: 'PUT',
      url: `/v1/workouts/${WORKOUT_ID}/question`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { question: ' Как заменить упражнение? ', expectedVersion: 3 },
    })
    const answer = await app.inject({
      method: 'PUT',
      url: `/v1/workouts/${WORKOUT_ID}/question/answer`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { reaction: null, review: 'Заменим в плане', expectedVersion: 4 },
    })
    const resolve = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/question/resolve`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { expectedVersion: 5 },
    })
    const snooze = await app.inject({
      method: 'POST',
      url: `/v1/clients/${CLIENTS_RESPONSE.clients[0]!.id}/attention/snooze`,
      headers: { 'x-fit-pilot-session': sessionToken },
    })

    expect([
      feedback.statusCode, review.statusCode, question.statusCode,
      answer.statusCode, resolve.statusCode, snooze.statusCode,
    ]).toEqual([200, 200, 200, 200, 200, 200])
    expect(writer.submitFeedback).toHaveBeenCalledWith(sessionToken, WORKOUT_ID, {
      sessionRpe: 8, wellbeing: 'normal', discomfort: true,
      comment: 'Тянуло плечо', expectedVersion: 1,
    })
    expect(writer.setReview).toHaveBeenCalledWith(sessionToken, WORKOUT_ID, {
      reaction: 'strong', review: 'Отличная работа', expectedVersion: 2,
    })
    expect(writer.askQuestion).toHaveBeenCalledWith(
      sessionToken, WORKOUT_ID, 'Как заменить упражнение?', 3,
    )
    expect(writer.answerQuestion).toHaveBeenCalledWith(sessionToken, WORKOUT_ID, {
      reaction: null, review: 'Заменим в плане', expectedVersion: 4,
    })
    expect(writer.resolveQuestion).toHaveBeenCalledWith(sessionToken, WORKOUT_ID, 5)
    expect(snooze.json()).toEqual({
      client: {
        id: CLIENTS_RESPONSE.clients[0]!.id,
        snoozedUntil: '2026-09-08T12:00:00.000Z',
      },
    })
  })

  it('rejects incomplete feedback and empty question answers', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const feedback = await app.inject({
      method: 'PUT',
      url: `/v1/workouts/${WORKOUT_ID}/feedback`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: {
        sessionRpe: 11, wellbeing: 'normal', discomfort: true,
        comment: '', expectedVersion: 1,
      },
    })
    const answer = await app.inject({
      method: 'PUT',
      url: `/v1/workouts/${WORKOUT_ID}/question/answer`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { reaction: null, review: ' ', expectedVersion: 1 },
    })

    expect([feedback.statusCode, answer.statusCode]).toEqual([400, 400])
    expect(writer.submitFeedback).not.toHaveBeenCalled()
    expect(writer.answerQuestion).not.toHaveBeenCalled()
  })
})

describe('pilot live workout core commands', () => {
  const sessionToken = 's'.repeat(43)

  it('starts, records, confirms and finishes with operation identities', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const started = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/start`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { expectedVersion: 1, operationId: OPERATION_IDS.start },
    })
    const draft = {
      weightKg: 42.5,
      reps: 10,
      durationMin: null,
      durationSec: null,
      distanceKm: null,
      rpe: 7.5,
    }
    const saved = await app.inject({
      method: 'PUT',
      url: `/v1/workout-sets/${WORKOUT_SET_ID}/draft`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: {
        expectedVersion: 1,
        operationId: OPERATION_IDS.save,
        draft,
      },
    })
    const confirmed = await app.inject({
      method: 'POST',
      url: `/v1/workout-sets/${WORKOUT_SET_ID}/confirm`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { expectedVersion: 2, operationId: OPERATION_IDS.confirm },
    })
    const finished = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/finish`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { expectedVersion: 2, operationId: OPERATION_IDS.finish },
    })

    expect(started.statusCode).toBe(200)
    expect(started.json()).toEqual({
      workout: { id: WORKOUT_ID, version: 2, replayed: false },
    })
    expect(saved.json()).toEqual({
      set: { id: WORKOUT_SET_ID, version: 2, replayed: false },
    })
    expect(confirmed.json()).toEqual({
      set: { id: WORKOUT_SET_ID, version: 3, replayed: false },
    })
    expect(finished.json()).toEqual({
      workout: { id: WORKOUT_ID, version: 3, replayed: false },
    })
    expect(finished.headers['cache-control']).toBe('no-store')
    expect(writer.startLive).toHaveBeenCalledWith(
      sessionToken,
      WORKOUT_ID,
      1,
      OPERATION_IDS.start,
    )
    expect(writer.saveLiveSet).toHaveBeenCalledWith(
      sessionToken,
      WORKOUT_SET_ID,
      draft,
      1,
      OPERATION_IDS.save,
    )
    expect(writer.confirmLiveSet).toHaveBeenCalledWith(
      sessionToken,
      WORKOUT_SET_ID,
      2,
      OPERATION_IDS.confirm,
    )
    expect(writer.finishLive).toHaveBeenCalledWith(
      sessionToken,
      WORKOUT_ID,
      2,
      OPERATION_IDS.finish,
    )
  })

  it('rejects malformed operation and set inputs before calling the writer', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const invalidOperation = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/start`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { expectedVersion: 1, operationId: 'not-a-uuid' },
    })
    const invalidSet = await app.inject({
      method: 'PUT',
      url: `/v1/workout-sets/${WORKOUT_SET_ID}/draft`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: {
        expectedVersion: 1,
        operationId: OPERATION_IDS.save,
        draft: { reps: -1 },
      },
    })

    expect(invalidOperation.statusCode).toBe(400)
    expect(invalidSet.statusCode).toBe(400)
    expect(writer.startLive).not.toHaveBeenCalled()
    expect(writer.saveLiveSet).not.toHaveBeenCalled()
  })

  it('requires the opaque session for live commands', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/finish`,
      payload: { expectedVersion: 2, operationId: OPERATION_IDS.finish },
    })

    expect(response.statusCode).toBe(401)
    expect(writer.finishLive).not.toHaveBeenCalled()
  })
})

describe('pilot live workout structural commands', () => {
  const sessionToken = 's'.repeat(43)
  const exercise = {
    source: 'system' as const,
    ref: 'squat',
    customExerciseId: null,
    name: 'Приседание',
    muscleGroup: 'legs' as const,
    inputKind: 'strength' as const,
  }

  it('adds, removes, reorders, replaces and comments with operation identities', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const appendedExercise = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/exercises`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: {
        expectedVersion: 2,
        operationId: OPERATION_IDS.appendExercise,
        exercise,
      },
    })
    const appendedSet = await app.inject({
      method: 'POST',
      url: `/v1/workout-exercises/${WORKOUT_EXERCISE_ID}/sets`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { expectedVersion: 3, operationId: OPERATION_IDS.appendSet },
    })
    const removedSet = await app.inject({
      method: 'DELETE',
      url: `/v1/workout-sets/${WORKOUT_SET_ID}`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { expectedVersion: 4, operationId: OPERATION_IDS.removeSet },
    })
    const reordered = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/blocks/${WORKOUT_BLOCK_ID}/reorder`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: {
        expectedVersion: 5,
        operationId: OPERATION_IDS.reorder,
        direction: -1,
      },
    })
    const replaced = await app.inject({
      method: 'PUT',
      url: `/v1/workouts/${WORKOUT_ID}/exercises/${WORKOUT_EXERCISE_ID}`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: {
        expectedVersion: 6,
        operationId: OPERATION_IDS.replace,
        exercise,
      },
    })
    const commented = await app.inject({
      method: 'PUT',
      url: `/v1/workout-exercises/${WORKOUT_EXERCISE_ID}/comment`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: {
        expectedVersion: 7,
        operationId: OPERATION_IDS.comment,
        comment: 'Держи спину',
      },
    })

    expect(appendedExercise.statusCode).toBe(201)
    expect(appendedExercise.json()).toEqual({
      exercise: {
        id: WORKOUT_EXERCISE_ID,
        version: 3,
        replayed: false,
      },
    })
    expect(appendedSet.statusCode).toBe(201)
    expect(appendedSet.json()).toEqual({
      set: { id: WORKOUT_SET_ID, version: 4, replayed: false },
    })
    expect(removedSet.json()).toEqual({
      set: { id: WORKOUT_SET_ID, version: 5, replayed: false },
    })
    expect(reordered.json()).toEqual({
      block: { id: WORKOUT_BLOCK_ID, version: 6, replayed: false },
    })
    expect(replaced.json()).toEqual({
      exercise: {
        id: WORKOUT_EXERCISE_ID,
        version: 7,
        replayed: false,
      },
    })
    expect(commented.json()).toEqual({
      exercise: {
        id: WORKOUT_EXERCISE_ID,
        version: 8,
        replayed: false,
      },
    })
    expect(commented.headers['cache-control']).toBe('no-store')
    expect(writer.appendLiveExercise).toHaveBeenCalledWith(
      sessionToken,
      WORKOUT_ID,
      exercise,
      2,
      OPERATION_IDS.appendExercise,
    )
    expect(writer.appendLiveSet).toHaveBeenCalledWith(
      sessionToken,
      WORKOUT_EXERCISE_ID,
      3,
      OPERATION_IDS.appendSet,
    )
    expect(writer.removeLiveSet).toHaveBeenCalledWith(
      sessionToken,
      WORKOUT_SET_ID,
      4,
      OPERATION_IDS.removeSet,
    )
    expect(writer.reorderLiveBlock).toHaveBeenCalledWith(
      sessionToken,
      WORKOUT_ID,
      WORKOUT_BLOCK_ID,
      -1,
      5,
      OPERATION_IDS.reorder,
    )
    expect(writer.replaceLiveExercise).toHaveBeenCalledWith(
      sessionToken,
      WORKOUT_ID,
      WORKOUT_EXERCISE_ID,
      exercise,
      6,
      OPERATION_IDS.replace,
    )
    expect(writer.setLiveExerciseComment).toHaveBeenCalledWith(
      sessionToken,
      WORKOUT_EXERCISE_ID,
      'Держи спину',
      7,
      OPERATION_IDS.comment,
    )
  })

  it('rejects malformed structure commands before calling the writer', async () => {
    const writer = buildWorkoutsWriter()
    const app = buildApp({
      pilotWorkoutsWriter: writer.pilotWorkoutsWriter,
      logger: false,
    })
    apps.push(app)

    const invalidExercise = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/exercises`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: {
        expectedVersion: 2,
        operationId: OPERATION_IDS.appendExercise,
        exercise: { ...exercise, name: '' },
      },
    })
    const invalidReorder = await app.inject({
      method: 'POST',
      url: `/v1/workouts/${WORKOUT_ID}/blocks/${WORKOUT_BLOCK_ID}/reorder`,
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: {
        expectedVersion: 5,
        operationId: OPERATION_IDS.reorder,
        direction: 0,
      },
    })

    expect(invalidExercise.statusCode).toBe(400)
    expect(invalidReorder.statusCode).toBe(400)
    expect(writer.appendLiveExercise).not.toHaveBeenCalled()
    expect(writer.reorderLiveBlock).not.toHaveBeenCalled()
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
