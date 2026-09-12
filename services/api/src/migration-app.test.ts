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
import {
  StageRolloutProfileNotReadyError,
  type StageRolloutAssignmentManager,
} from './db/stage-rollout-assignment.js'
import { buildMigrationApp } from './migration-app.js'
import { TenantMigrationArtifactError } from './tenant-migration/bundle.js'
import { TenantMigrationError } from './tenant-migration/engine.js'

const apps: ReturnType<typeof buildMigrationApp>[] = []
const STAGE_CLIENT_ID = '10000000-0000-4000-8000-000000000001'

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
    expect(response.json()).toEqual({
      status: 'migration_failed',
      error: { code: 'unknown' },
    })
    expect(response.body).not.toContain('secret')
  })

  it('returns only allowlisted diagnostics for a database migration error', async () => {
    const error = Object.assign(
      new Error('relation public.training_summary_generation_guard does not exist'),
      { code: '42P01' },
    )
    const app = buildMigrationApp({
      logger: false,
      runMigrations: vi.fn().mockRejectedValue(error),
    })
    apps.push(app)

    const response = await app.inject({ method: 'POST', url: '/migrate' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      status: 'migration_failed',
      error: {
        code: '42P01',
        message: 'relation public.training_summary_generation_guard does not exist',
      },
    })
  })
})

describe('stage runtime database readiness', () => {
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
    const runtimeDatabaseReadiness = vi.fn().mockResolvedValue({
      ready: true,
      progressResponseBytes: 123,
    })
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
      runtimeDatabaseReadiness,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/runtime-database/readiness',
      headers: {
        'x-fit-pilot-session': 'stage-session-token',
        'x-fit-stage-client-id': STAGE_CLIENT_ID,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'runtime_database_ready',
      progressResponseBytes: 123,
    })
    expect(runtimeDatabaseReadiness).toHaveBeenCalledWith(
      'stage-session-token',
      STAGE_CLIENT_ID,
    )
  })

  it('requires a pilot session without exposing the readiness probe', async () => {
    const runtimeDatabaseReadiness = vi.fn().mockResolvedValue({
      ready: true,
      progressResponseBytes: 123,
    })
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
      runtimeDatabaseReadiness,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/runtime-database/readiness',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ status: 'invalid_request' })
    expect(runtimeDatabaseReadiness).not.toHaveBeenCalled()
  })

  it('returns only a safe failure category and code', async () => {
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
      runtimeDatabaseReadiness: () => Promise.resolve({
        ready: false,
        check: 'training-data',
        category: 'authentication',
        code: '28P01',
      }),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/runtime-database/readiness',
      headers: {
        'x-fit-pilot-session': 'stage-session-token',
        'x-fit-stage-client-id': STAGE_CLIENT_ID,
      },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      status: 'runtime_database_not_ready',
      check: 'training-data',
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

describe('stage rollout assignment', () => {
  function buildRolloutAssignment(
    apply: StageRolloutAssignmentManager['apply'] = () => Promise.resolve({
      accountRole: 'trainer',
      domainReady: true,
      identityLinked: false,
      rolloutEnabled: true,
    }),
  ) {
    const rollout = vi.fn(apply)
    const app = buildMigrationApp({
      logger: false,
      rolloutAssignment: { apply: rollout },
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)
    return { app, rollout }
  }

  it('does not expose the route unless explicitly enabled', async () => {
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/rollout-assignments/yandex',
      payload: { action: 'inspect', profileId: STAGE_CLIENT_ID },
    })

    expect(response.statusCode).toBe(404)
  })

  it.each([
    ['inspect', 'rollout_inspected'],
    ['enable', 'rollout_enabled'],
    ['disable', 'rollout_disabled'],
  ] as const)('applies a validated %s request', async (action, status) => {
    const { app, rollout } = buildRolloutAssignment(() => Promise.resolve({
      accountRole: 'trainer',
      domainReady: true,
      identityLinked: true,
      rolloutEnabled: action !== 'disable',
    }))

    const response = await app.inject({
      method: 'POST',
      url: '/stage/rollout-assignments/yandex',
      payload: { action, profileId: STAGE_CLIENT_ID },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status,
      accountRole: 'trainer',
      domainReady: true,
      identityLinked: true,
      rolloutEnabled: action !== 'disable',
    })
    expect(rollout).toHaveBeenCalledWith(action, { profileId: STAGE_CLIENT_ID })
    expect(response.body).not.toContain(STAGE_CLIENT_ID)
  })

  it('accepts the non-reversible fingerprint recorded by tenant migration', async () => {
    const { app, rollout } = buildRolloutAssignment()
    const tenantFingerprint = 'a'.repeat(16)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/rollout-assignments/yandex',
      payload: { action: 'inspect', tenantFingerprint },
    })

    expect(response.statusCode).toBe(200)
    expect(rollout).toHaveBeenCalledWith('inspect', { tenantFingerprint })
    expect(response.body).not.toContain(tenantFingerprint)
  })

  it('rejects malformed profile identifiers before touching the database', async () => {
    const { app, rollout } = buildRolloutAssignment()

    const response = await app.inject({
      method: 'POST',
      url: '/stage/rollout-assignments/yandex',
      payload: { action: 'enable', profileId: 'not-a-profile' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ status: 'invalid_request' })
    expect(rollout).not.toHaveBeenCalled()
  })

  it('rejects ambiguous rollout targets before touching the database', async () => {
    const { app, rollout } = buildRolloutAssignment()

    const response = await app.inject({
      method: 'POST',
      url: '/stage/rollout-assignments/yandex',
      payload: {
        action: 'enable',
        profileId: STAGE_CLIENT_ID,
        tenantFingerprint: 'a'.repeat(16),
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ status: 'invalid_request' })
    expect(rollout).not.toHaveBeenCalled()
  })

  it('keeps profile readiness and unexpected failures generic', async () => {
    const notReady = buildRolloutAssignment(() => Promise.reject(
      new StageRolloutProfileNotReadyError(),
    )).app
    const failed = buildRolloutAssignment(() => Promise.reject(
      new Error('postgresql://owner:secret@database'),
    )).app

    const request = {
      method: 'POST' as const,
      url: '/stage/rollout-assignments/yandex',
      payload: { action: 'enable', profileId: STAGE_CLIENT_ID },
    }
    const notReadyResponse = await notReady.inject(request)
    const failedResponse = await failed.inject(request)

    expect(notReadyResponse.statusCode).toBe(409)
    expect(notReadyResponse.json()).toEqual({ status: 'profile_not_ready' })
    expect(failedResponse.statusCode).toBe(500)
    expect(failedResponse.json()).toEqual({ status: 'rollout_assignment_failed' })
    expect(failedResponse.body).not.toContain('secret')
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
      clientId: STAGE_CLIENT_ID,
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
        clientId: STAGE_CLIENT_ID,
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

describe('stage tenant migration', () => {
  const envelope = {
    format: 'fit-tenant-envelope-v1',
    ciphertext: 'encrypted-payload',
  }
  const report = {
    mode: 'dry-run' as const,
    tenantFingerprint: 'a'.repeat(16),
    tables: [{ name: 'public.profiles', rows: 2, inserted: 2 }],
  }

  function buildTenantMigration(
    run = vi.fn().mockResolvedValue(report),
  ) {
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
      stageTenantMigration: { run },
    })
    apps.push(app)
    return { app, run }
  }

  it('does not expose tenant migration routes unless explicitly enabled', async () => {
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/tenant-migration/dry-run',
      headers: { 'x-fit-tenant-migration-passphrase': 'p'.repeat(32) },
      payload: envelope,
    })

    expect(response.statusCode).toBe(404)
  })

  it('runs an encrypted dry-run and returns only aggregate diagnostics', async () => {
    const { app, run } = buildTenantMigration()

    const response = await app.inject({
      method: 'POST',
      url: '/stage/tenant-migration/dry-run',
      headers: { 'x-fit-tenant-migration-passphrase': 'p'.repeat(32) },
      payload: envelope,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'tenant_migration_dry_run',
      tenantFingerprint: 'a'.repeat(16),
      tables: report.tables,
    })
    expect(run).toHaveBeenCalledWith(envelope, 'p'.repeat(32), false)
    expect(response.body).not.toContain('encrypted-payload')
    expect(response.body).not.toContain('p'.repeat(32))
  })

  it('requires an independent exact confirmation before apply', async () => {
    const { app, run } = buildTenantMigration()

    const rejected = await app.inject({
      method: 'POST',
      url: '/stage/tenant-migration/apply',
      headers: { 'x-fit-tenant-migration-passphrase': 'p'.repeat(32) },
      payload: envelope,
    })
    expect(rejected.statusCode).toBe(403)
    expect(rejected.json()).toEqual({ status: 'apply_not_confirmed' })
    expect(run).not.toHaveBeenCalled()

    const accepted = await app.inject({
      method: 'POST',
      url: '/stage/tenant-migration/apply',
      headers: {
        'x-fit-tenant-migration-passphrase': 'p'.repeat(32),
        'x-fit-tenant-migration-confirmation': 'APPLY_TENANT_TO_YANDEX_STAGE',
      },
      payload: envelope,
    })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toEqual({
      status: 'tenant_migration_applied',
      tenantFingerprint: 'a'.repeat(16),
      tables: report.tables,
    })
    expect(run).toHaveBeenCalledWith(envelope, 'p'.repeat(32), true)
  })

  it('rejects missing passphrases and oversized artifacts before import', async () => {
    const { app, run } = buildTenantMigration()

    const missingPassphrase = await app.inject({
      method: 'POST',
      url: '/stage/tenant-migration/dry-run',
      payload: envelope,
    })
    expect(missingPassphrase.statusCode).toBe(400)

    const oversized = await app.inject({
      method: 'POST',
      url: '/stage/tenant-migration/dry-run',
      headers: { 'x-fit-tenant-migration-passphrase': 'p'.repeat(32) },
      payload: { ciphertext: 'x'.repeat(3 * 1024 * 1024) },
    })
    expect(oversized.statusCode).toBe(413)
    expect(run).not.toHaveBeenCalled()
  })

  it('keeps artifact, validation and connection failures safe', async () => {
    for (const [error, expectedStatus, expectedBody] of [
      [
        new TenantMigrationArtifactError('artifact_decryption_failed'),
        400,
        { status: 'tenant_migration_artifact_rejected' },
      ],
      [
        new TenantMigrationError('target_validation_failed:public.profiles'),
        409,
        {
          status: 'tenant_migration_rejected',
          code: 'target_validation_failed:public.profiles',
        },
      ],
      [
        new Error('postgresql://owner:secret@private-host'),
        500,
        { status: 'tenant_migration_failed' },
      ],
    ] as const) {
      const { app } = buildTenantMigration(vi.fn().mockRejectedValue(error))
      const response = await app.inject({
        method: 'POST',
        url: '/stage/tenant-migration/dry-run',
        headers: { 'x-fit-tenant-migration-passphrase': 'p'.repeat(32) },
        payload: envelope,
      })
      expect(response.statusCode).toBe(expectedStatus)
      expect(response.json()).toEqual(expectedBody)
      expect(response.body).not.toContain('secret')
      expect(response.body).not.toContain('private-host')
    }
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
