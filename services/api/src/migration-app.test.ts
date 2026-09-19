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
import {
  encodeStageTenantMigrationTransport,
  STAGE_TENANT_BINARY_CONTENT_TYPE,
} from './tenant-migration/transport.js'
import type { BrotliTenantMigrationEnvelope } from './tenant-migration/types.js'
import {
  VITAL_MEDIA_APPLY_CONFIRMATION,
  VITAL_MEDIA_BINARY_CONTENT_TYPE,
  type VitalMediaDeploymentService,
} from './vital-media-deployment.js'

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

describe('stage Vital media deployment', () => {
  function buildVitalMediaDeployment() {
    const audit = vi.fn().mockResolvedValue({
      bytes: 71_514_430,
      fingerprint: 'a'.repeat(16),
      mismatched: 0,
      missing: 0,
      objects: 2_010,
      unexpected: 0,
      verified: 2_010,
    })
    const preflight = vi.fn((allowWrite: boolean) => Promise.resolve({
      bucket: 'fit-media-example',
      private: true as const,
      versioning: allowWrite
        ? 'verified_by_write_probe' as const
        : 'not_probed_read_only' as const,
    }))
    const upload = vi.fn().mockResolvedValue('uploaded' as const)
    const deployment: VitalMediaDeploymentService = {
      audit,
      preflight,
      upload,
    }
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
      vitalMediaDeployment: deployment,
    })
    apps.push(app)
    return { app, audit, preflight, upload }
  }

  it('does not expose media deployment routes unless explicitly configured', async () => {
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/vital-media/preflight',
      payload: { allowWrite: false },
    })

    expect(response.statusCode).toBe(404)
  })

  it('keeps the bucket probe read-only unless apply is confirmed exactly', async () => {
    const { app, preflight } = buildVitalMediaDeployment()
    const rejected = await app.inject({
      method: 'POST',
      url: '/stage/vital-media/preflight',
      payload: { allowWrite: true },
    })
    const audited = await app.inject({
      method: 'POST',
      url: '/stage/vital-media/preflight',
      payload: { allowWrite: false },
    })
    const confirmed = await app.inject({
      method: 'POST',
      url: '/stage/vital-media/preflight',
      headers: {
        'x-fit-vital-media-confirmation': VITAL_MEDIA_APPLY_CONFIRMATION,
      },
      payload: { allowWrite: true },
    })

    expect(rejected.statusCode).toBe(403)
    expect(audited.statusCode).toBe(200)
    expect(audited.json()).toMatchObject({
      private: true,
      versioning: 'not_probed_read_only',
    })
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json()).toMatchObject({
      private: true,
      versioning: 'verified_by_write_probe',
    })
    expect(preflight).toHaveBeenNthCalledWith(1, false)
    expect(preflight).toHaveBeenNthCalledWith(2, true)
  })

  it('accepts one confirmed binary object without exposing its bytes', async () => {
    const { app, upload } = buildVitalMediaDeployment()
    const body = Buffer.from('private-animation')
    const response = await app.inject({
      method: 'PUT',
      url: '/stage/vital-media/object',
      headers: {
        'content-type': VITAL_MEDIA_BINARY_CONTENT_TYPE,
        'x-fit-vital-media-bytes': String(body.byteLength),
        'x-fit-vital-media-confirmation': VITAL_MEDIA_APPLY_CONFIRMATION,
        'x-fit-vital-media-path': 'exercise.mp4',
        'x-fit-vital-media-sha256': 'b'.repeat(64),
      },
      payload: body,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'vital_media_uploaded' })
    expect(upload).toHaveBeenCalledWith({
      bytes: body.byteLength,
      path: 'exercise.mp4',
      sha256: 'b'.repeat(64),
    }, body)
    expect(response.body).not.toContain('private-animation')
  })

  it('returns only aggregate audit data', async () => {
    const { app, audit } = buildVitalMediaDeployment()
    const files = [{ bytes: 10, path: 'exercise.jpg', sha256: 'c'.repeat(64) }]
    const response = await app.inject({
      method: 'POST',
      url: '/stage/vital-media/audit',
      payload: { files },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'vital_media_audited',
      bytes: 71_514_430,
      fingerprint: 'a'.repeat(16),
      mismatched: 0,
      missing: 0,
      objects: 2_010,
      unexpected: 0,
      verified: 2_010,
    })
    expect(audit).toHaveBeenCalledWith(files)
    expect(response.body).not.toContain('exercise.jpg')
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
    applyLinkedProfiles: StageRolloutAssignmentManager['applyLinkedProfiles'] = () => Promise.resolve({
      domainReadyProfiles: 20,
      linkedProfiles: 12,
      rolloutEnabledProfiles: 12,
    }),
  ) {
    const rollout = vi.fn(apply)
    const batchRollout = vi.fn(applyLinkedProfiles)
    const app = buildMigrationApp({
      logger: false,
      rolloutAssignment: { apply: rollout, applyLinkedProfiles: batchRollout },
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)
    return { app, batchRollout, rollout }
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

  it.each([
    ['inspect', 'rollout_batch_inspected'],
    ['enable', 'rollout_batch_enabled'],
    ['disable', 'rollout_batch_disabled'],
  ] as const)('applies a validated linked-profile batch %s request', async (action, status) => {
    const { app, batchRollout } = buildRolloutAssignment()

    const response = await app.inject({
      method: 'POST',
      url: '/stage/rollout-assignments/yandex/linked-ready',
      payload: { action, scope: 'linked-ready' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status,
      domainReadyProfiles: 20,
      linkedProfiles: 12,
      rolloutEnabledProfiles: 12,
    })
    expect(batchRollout).toHaveBeenCalledWith(action)
    expect(response.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)
  })

  it('rejects a batch request without the exact linked-ready scope', async () => {
    const { app, batchRollout } = buildRolloutAssignment()

    const response = await app.inject({
      method: 'POST',
      url: '/stage/rollout-assignments/yandex/linked-ready',
      payload: { action: 'enable', scope: 'all' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ status: 'invalid_request' })
    expect(batchRollout).not.toHaveBeenCalled()
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
      mediaSessionToken: 'm'.repeat(43),
      mediaSessionExpiresAt: '2026-08-22T12:15:00.000Z',
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
      mediaSession: {
        token: 'm'.repeat(43),
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
  const binaryEnvelope: BrotliTenantMigrationEnvelope = {
    format: 'fit-tenant-envelope-v3',
    compression: { name: 'brotli' },
    kdf: {
      name: 'scrypt',
      salt: Buffer.alloc(16, 1).toString('base64'),
    },
    cipher: {
      name: 'aes-256-gcm',
      iv: Buffer.alloc(12, 2).toString('base64'),
      authTag: Buffer.alloc(16, 3).toString('base64'),
    },
    ciphertext: Buffer.from('encrypted-payload').toString('base64'),
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
    expect(run).toHaveBeenCalledWith(envelope, 'p'.repeat(32), false, false)
    expect(response.body).not.toContain('encrypted-payload')
    expect(response.body).not.toContain('p'.repeat(32))
  })

  it('reconstructs a Brotli envelope from the encrypted binary transport', async () => {
    const { app, run } = buildTenantMigration()
    const transport = encodeStageTenantMigrationTransport(binaryEnvelope)

    const response = await app.inject({
      method: 'POST',
      url: '/stage/tenant-migration/dry-run',
      headers: {
        ...transport.headers,
        'content-type': STAGE_TENANT_BINARY_CONTENT_TYPE,
        'x-fit-tenant-migration-passphrase': 'p'.repeat(32),
      },
      payload: transport.body,
    })

    expect(response.statusCode).toBe(200)
    expect(run).toHaveBeenCalledWith(
      binaryEnvelope,
      'p'.repeat(32),
      false,
      false,
    )
  })

  it('rejects binary artifacts with missing envelope metadata', async () => {
    const { app, run } = buildTenantMigration()

    const response = await app.inject({
      method: 'POST',
      url: '/stage/tenant-migration/dry-run',
      headers: {
        'content-type': STAGE_TENANT_BINARY_CONTENT_TYPE,
        'x-fit-tenant-migration-passphrase': 'p'.repeat(32),
      },
      payload: Buffer.from('encrypted-payload'),
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ status: 'invalid_request' })
    expect(run).not.toHaveBeenCalled()
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
    expect(run).toHaveBeenCalledWith(envelope, 'p'.repeat(32), true, false)
  })

  it('allows missing media only through an explicit private request policy', async () => {
    const { app, run } = buildTenantMigration()

    const accepted = await app.inject({
      method: 'POST',
      url: '/stage/tenant-migration/dry-run',
      headers: {
        'x-fit-tenant-migration-passphrase': 'p'.repeat(32),
        'x-fit-tenant-migration-media-policy': 'allow-missing',
      },
      payload: envelope,
    })
    expect(accepted.statusCode).toBe(200)
    expect(run).toHaveBeenCalledWith(envelope, 'p'.repeat(32), false, true)

    const rejected = await app.inject({
      method: 'POST',
      url: '/stage/tenant-migration/dry-run',
      headers: {
        'x-fit-tenant-migration-passphrase': 'p'.repeat(32),
        'x-fit-tenant-migration-media-policy': 'skip',
      },
      payload: envelope,
    })
    expect(rejected.statusCode).toBe(400)
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
      payload: { ciphertext: 'x'.repeat(3_400_000) },
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
