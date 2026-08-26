import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  YandexIdentityRejectedError,
  YandexIdentityUnavailableError,
  type YandexIdentityProvider,
} from './auth/yandex-identity.js'
import {
  PilotEnrollmentConflictError,
  type PilotEnroller,
} from './db/yandex-pilot-enrollment.js'
import {
  StageDatabaseReaderNotReadyError,
  type StageDatabaseReaderAccessManager,
} from './db/stage-database-reader-access.js'
import type { DatabaseConnection, DatabasePool } from './db/types.js'
import { buildMigrationApp } from './migration-app.js'

const apps: ReturnType<typeof buildMigrationApp>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('migration endpoint', () => {
  it('reports the migration names returned by the locked runner', async () => {
    const runMigrations = vi.fn().mockResolvedValue(['000003_client_memberships'])
    const app = buildMigrationApp({ logger: false, runMigrations })
    apps.push(app)

    const response = await app.inject({ method: 'POST', url: '/migrate' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'migrated',
      migrations: ['000003_client_memberships'],
    })
    expect(runMigrations).toHaveBeenCalledOnce()
  })

  it('does not expose migration or connection errors', async () => {
    const runMigrations = vi
      .fn()
      .mockRejectedValue(new Error('postgresql://owner:secret@database'))
    const app = buildMigrationApp({ logger: false, runMigrations })
    apps.push(app)

    const response = await app.inject({ method: 'POST', url: '/migrate' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ status: 'migration_failed' })
    expect(response.body).not.toContain('secret')
  })
})

describe('stage runtime database readiness', () => {
  function buildRuntimePool(error?: unknown): DatabasePool {
    const connection: DatabaseConnection = {
      query: error === undefined
        ? vi.fn().mockResolvedValue([])
        : vi.fn().mockRejectedValue(error),
      release: vi.fn(),
    }
    return {
      connect: vi.fn().mockResolvedValue(connection),
      end: vi.fn().mockResolvedValue(undefined),
    }
  }

  it('does not expose the route unless a runtime pool is configured', async () => {
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/runtime-database/readiness',
    })

    expect(response.statusCode).toBe(404)
  })

  it('confirms the exact runtime connection before API deployment', async () => {
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
      runtimeDatabasePool: buildRuntimePool(),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/runtime-database/readiness',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'runtime_database_ready' })
  })

  it('returns only a safe failure category and code', async () => {
    const failure = Object.assign(
      new Error('postgresql://fit_api:secret@private-host'),
      { code: '28P01' },
    )
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
      runtimeDatabasePool: buildRuntimePool(failure),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/runtime-database/readiness',
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      status: 'runtime_database_not_ready',
      category: 'authentication',
      code: '28P01',
    })
    expect(response.body).not.toContain('secret')
    expect(response.body).not.toContain('private-host')
  })
})

describe('stage database reader access', () => {
  function buildDatabaseAccess(
    setAccess: StageDatabaseReaderAccessManager['setAccess'] =
      () => Promise.resolve(),
  ) {
    const access = vi.fn(setAccess)
    const app = buildMigrationApp({
      databaseReaderAccess: { setAccess: access },
      logger: false,
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)
    return { access, app }
  }

  it('does not expose the route unless explicitly enabled', async () => {
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/database-access/readers',
      payload: { action: 'grant', databaseUsername: 'stage_reader' },
    })

    expect(response.statusCode).toBe(404)
  })

  it.each([
    ['grant', 'access_granted'],
    ['revoke', 'access_revoked'],
  ] as const)('applies an idempotent %s request', async (action, status) => {
    const { access, app } = buildDatabaseAccess()

    const response = await app.inject({
      method: 'POST',
      url: '/stage/database-access/readers',
      payload: { action, databaseUsername: 'stage.reader-1' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status })
    expect(access).toHaveBeenCalledWith(action, 'stage.reader-1')
    expect(response.body).not.toContain('stage.reader-1')
  })

  it('rejects malformed requests before touching the database', async () => {
    const { access, app } = buildDatabaseAccess()

    const response = await app.inject({
      method: 'POST',
      url: '/stage/database-access/readers',
      payload: { action: 'owner', databaseUsername: 'reader with spaces' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ status: 'invalid_request' })
    expect(access).not.toHaveBeenCalled()
  })

  it('reports a missing or privileged database user without exposing it', async () => {
    const { app } = buildDatabaseAccess(
      () => Promise.reject(new StageDatabaseReaderNotReadyError()),
    )

    const response = await app.inject({
      method: 'POST',
      url: '/stage/database-access/readers',
      payload: { action: 'grant', databaseUsername: 'missing_reader' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ status: 'database_user_not_ready' })
    expect(response.body).not.toContain('missing_reader')
  })

  it('keeps unexpected database failures generic', async () => {
    const { app } = buildDatabaseAccess(
      () => Promise.reject(new Error('postgresql://owner:secret@database')),
    )

    const response = await app.inject({
      method: 'POST',
      url: '/stage/database-access/readers',
      payload: { action: 'grant', databaseUsername: 'stage_reader' },
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ status: 'database_access_failed' })
    expect(response.body).not.toContain('secret')
  })
})

describe('stage workout fixture', () => {
  it('does not expose the fixture route unless explicitly enabled', async () => {
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/fixtures/workout-read-model',
    })

    expect(response.statusCode).toBe(404)
  })

  it('returns an ephemeral session without exposing database details', async () => {
    const load = vi.fn().mockResolvedValue({
      seededTrainerCount: 2,
      sessionToken: 's'.repeat(43),
      sessionExpiresAt: '2026-08-22T12:15:00.000Z',
      clientSessionToken: 'c'.repeat(43),
      clientSessionExpiresAt: '2026-08-22T12:15:00.000Z',
    })
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
      stageWorkoutFixture: { load },
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/fixtures/workout-read-model',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'fixture_ready',
      seededTrainerCount: 2,
      session: {
        token: 's'.repeat(43),
        expiresAt: '2026-08-22T12:15:00.000Z',
      },
      clientSession: {
        token: 'c'.repeat(43),
        expiresAt: '2026-08-22T12:15:00.000Z',
      },
    })
    expect(load).toHaveBeenCalledOnce()
  })

  it('keeps fixture failures generic', async () => {
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
      stageWorkoutFixture: {
        load: () => Promise.reject(
          new Error('postgresql://owner:secret@database'),
        ),
      },
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/fixtures/workout-read-model',
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ status: 'fixture_failed' })
    expect(response.body).not.toContain('secret')
  })
})

describe('stage Yandex ID pilot enrollment', () => {
  const subjectHash = 'd'.repeat(64)

  function buildPilot(overrides: {
    enroll?: PilotEnroller['enroll']
    verifyAccessToken?: YandexIdentityProvider['verifyAccessToken']
  } = {}) {
    const verifyAccessToken = vi.fn(
      overrides.verifyAccessToken
      ?? (() => Promise.resolve({ subjectHash })),
    )
    const enroll = vi.fn(
      overrides.enroll ?? (() => Promise.resolve({ created: true })),
    )
    const app = buildMigrationApp({
      logger: false,
      pilotEnrollment: {
        enroller: { enroll },
        identityProvider: { verifyAccessToken },
      },
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)
    return { app, enroll, verifyAccessToken }
  }

  it('does not register the enrollment route unless explicitly enabled', async () => {
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/pilot/enroll',
      payload: { accessToken: 'test-token', accountRole: 'trainer' },
    })

    expect(response.statusCode).toBe(404)
  })

  it('validates identity and creates a read-only rollout assignment', async () => {
    const { app, enroll, verifyAccessToken } = buildPilot()

    const response = await app.inject({
      method: 'POST',
      url: '/pilot/enroll',
      payload: { accessToken: 'test-token', accountRole: 'trainer' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'enrolled',
      accessMode: 'read_only',
      created: true,
    })
    expect(verifyAccessToken).toHaveBeenCalledWith('test-token')
    expect(enroll).toHaveBeenCalledWith(subjectHash, 'trainer')
    expect(response.body).not.toContain('test-token')
    expect(response.body).not.toContain(subjectHash)
  })

  it('rejects malformed requests before calling identity services', async () => {
    const { app, enroll, verifyAccessToken } = buildPilot()

    const response = await app.inject({
      method: 'POST',
      url: '/pilot/enroll',
      payload: { accessToken: '', accountRole: 'owner' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ status: 'invalid_request' })
    expect(verifyAccessToken).not.toHaveBeenCalled()
    expect(enroll).not.toHaveBeenCalled()
  })

  it('returns generic errors for rejected or unavailable identities', async () => {
    for (const [error, expectedStatus, expectedBody] of [
      [new YandexIdentityRejectedError(), 401, 'identity_rejected'],
      [new YandexIdentityUnavailableError(), 503, 'enrollment_unavailable'],
    ] as const) {
      const { app } = buildPilot({
        verifyAccessToken: () => Promise.reject(error),
      })
      const response = await app.inject({
        method: 'POST',
        url: '/pilot/enroll',
        payload: { accessToken: 'secret-token', accountRole: 'client' },
      })

      expect(response.statusCode).toBe(expectedStatus)
      expect(response.json()).toEqual({ status: expectedBody })
      expect(response.body).not.toContain('secret-token')
    }
  })

  it('does not change the role of an existing identity', async () => {
    const { app } = buildPilot({
      enroll: () => Promise.reject(new PilotEnrollmentConflictError()),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/pilot/enroll',
      payload: { accessToken: 'test-token', accountRole: 'client' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ status: 'account_role_conflict' })
  })

  it('does not expose unexpected enrollment errors', async () => {
    const { app } = buildPilot({
      enroll: () => Promise.reject(new Error('database-password=secret')),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/pilot/enroll',
      payload: { accessToken: 'test-token', accountRole: 'trainer' },
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ status: 'enrollment_failed' })
    expect(response.body).not.toContain('secret')
  })
})
