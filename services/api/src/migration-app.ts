import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'

import {
  YandexIdentityRejectedError,
  type YandexIdentityProvider,
  YandexIdentityUnavailableError,
} from './auth/yandex-identity.js'
import {
  PilotEnrollmentConflictError,
  type PilotAccountRole,
  type PilotEnroller,
} from './db/yandex-pilot-enrollment.js'
import type { StageWorkoutFixtureLoader } from './db/stage-workout-fixture.js'
import type { RuntimeDomainReadinessResult } from './db/runtime-domain-readiness.js'
import {
  StageDatabaseReaderNotReadyError,
  type StageDatabaseReaderAccessAction,
  type StageDatabaseReaderAccessManager,
} from './db/stage-database-reader-access.js'
import {
  StageRolloutProfileNotReadyError,
  type StageRolloutAssignmentAction,
  type StageRolloutAssignmentManager,
  type StageRolloutAssignmentTarget,
} from './db/stage-rollout-assignment.js'
import { TenantMigrationArtifactError } from './tenant-migration/bundle.js'
import { TenantMigrationError } from './tenant-migration/engine.js'
import type { StageTenantMigrationRunner } from './tenant-migration/stage-runner.js'
import {
  decodeStageTenantMigrationTransport,
  STAGE_TENANT_ARTIFACT_LIMIT_BYTES,
  STAGE_TENANT_BINARY_CONTENT_TYPE,
} from './tenant-migration/transport.js'
import {
  VITAL_MEDIA_APPLY_CONFIRMATION,
  VITAL_MEDIA_BINARY_CONTENT_TYPE,
  VitalMediaDeploymentError,
  type VitalMediaDeploymentService,
  type VitalMediaManifestFile,
} from './vital-media-deployment.js'

interface PilotEnrollmentOptions {
  enroller: PilotEnroller
  identityProvider: YandexIdentityProvider
}

interface BuildMigrationAppOptions {
  databaseReaderAccess?: StageDatabaseReaderAccessManager
  logger?: boolean
  pilotEnrollment?: PilotEnrollmentOptions
  rolloutAssignment?: StageRolloutAssignmentManager
  runMigrations: () => Promise<readonly string[]>
  runtimeDatabaseReadiness?: (
    sessionToken: string,
    clientId: string,
  ) => Promise<RuntimeDomainReadinessResult>
  stageTenantMigration?: StageTenantMigrationRunner
  vitalMediaDeployment?: VitalMediaDeploymentService
  stageWorkoutFixture?: StageWorkoutFixtureLoader
}

const DATABASE_USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,62}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TENANT_FINGERPRINT_PATTERN = /^[0-9a-f]{16}$/
const STAGE_TENANT_APPLY_CONFIRMATION = 'APPLY_TENANT_TO_YANDEX_STAGE'
const SAFE_TENANT_MIGRATION_ERROR_PATTERN = /^[a-z0-9_.:-]{1,96}$/
const SAFE_DATABASE_ERROR_CODE_PATTERN = /^[A-Z0-9]{5}$/i
const SAFE_MIGRATION_ERROR_MESSAGE_PATTERN = /^[\p{L}\p{N}\s._:(),'"-]{1,500}$/u
const VITAL_MEDIA_MAX_OBJECT_BYTES = 1_048_576

function readVitalMediaManifest(body: unknown): readonly VitalMediaManifestFile[] | undefined {
  if (typeof body !== 'object' || body === null || !('files' in body)) {
    return undefined
  }
  const values: unknown = body.files
  if (!Array.isArray(values)) return undefined
  const files: VitalMediaManifestFile[] = []
  for (const value of values as unknown[]) {
    if (
      typeof value !== 'object'
      || value === null
      || !('path' in value)
      || !('bytes' in value)
      || !('sha256' in value)
      || typeof value.path !== 'string'
      || typeof value.bytes !== 'number'
      || typeof value.sha256 !== 'string'
    ) return undefined
    files.push({ path: value.path, bytes: value.bytes, sha256: value.sha256 })
  }
  return files
}

function readVitalMediaUpload(
  headers: Record<string, string | string[] | undefined>,
): VitalMediaManifestFile | undefined {
  const path = headers['x-fit-vital-media-path']
  const bytesHeader = headers['x-fit-vital-media-bytes']
  const sha256 = headers['x-fit-vital-media-sha256']
  if (
    typeof path !== 'string'
    || typeof bytesHeader !== 'string'
    || typeof sha256 !== 'string'
  ) return undefined
  const bytes = Number(bytesHeader)
  return { path, bytes, sha256 }
}

function migrationFailureDetails(error: unknown): {
  code: string
  message?: string
} {
  const code = typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    && SAFE_DATABASE_ERROR_CODE_PATTERN.test(error.code)
    ? error.code
    : 'unknown'
  const message = error instanceof Error
    && SAFE_MIGRATION_ERROR_MESSAGE_PATTERN.test(error.message)
    ? error.message
    : undefined

  return { code, ...(message === undefined ? {} : { message }) }
}

function readTenantMigrationPassphrase(
  header: string | string[] | undefined,
): string | undefined {
  if (
    typeof header !== 'string'
    || header.length < 20
    || header.length > 256
  ) return undefined
  return header
}

function tenantMigrationFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof TenantMigrationArtifactError) {
    return reply.code(400).send({ status: 'tenant_migration_artifact_rejected' })
  }
  if (error instanceof TenantMigrationError) {
    return reply.code(409).send({
      status: 'tenant_migration_rejected',
      code: SAFE_TENANT_MIGRATION_ERROR_PATTERN.test(error.code)
        ? error.code
        : 'unknown',
    })
  }
  return reply.code(500).send({ status: 'tenant_migration_failed' })
}

function readDatabaseReaderAccessRequest(body: unknown): {
  action: StageDatabaseReaderAccessAction
  databaseUsername: string
} | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  if (!('action' in body) || !('databaseUsername' in body)) return undefined
  const action = body.action
  const databaseUsername = body.databaseUsername
  if (
    (action !== 'grant' && action !== 'revoke')
    || typeof databaseUsername !== 'string'
    || !DATABASE_USERNAME_PATTERN.test(databaseUsername)
  ) return undefined
  return { action, databaseUsername }
}

function readEnrollmentRequest(body: unknown): {
  accessToken: string
  accountRole: PilotAccountRole
} | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  if (!('accessToken' in body) || !('accountRole' in body)) return undefined
  const accessToken = body.accessToken
  const accountRole = body.accountRole
  if (
    typeof accessToken !== 'string'
    || accessToken.length === 0
    || accessToken.length > 8_192
    || (accountRole !== 'trainer' && accountRole !== 'client')
  ) return undefined
  return { accessToken, accountRole }
}

function readRolloutAssignmentRequest(body: unknown): {
  action: StageRolloutAssignmentAction
  target: StageRolloutAssignmentTarget
} | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  if (!('action' in body)) return undefined
  const action = body.action
  if (
    action !== 'inspect'
    && action !== 'enable'
    && action !== 'disable'
  ) return undefined
  const hasProfileId = 'profileId' in body
  const hasTenantFingerprint = 'tenantFingerprint' in body
  if (hasProfileId === hasTenantFingerprint) return undefined
  if (hasProfileId) {
    const profileId = body.profileId
    if (typeof profileId !== 'string' || !UUID_PATTERN.test(profileId)) {
      return undefined
    }
    return { action, target: { profileId } }
  }
  if (!('tenantFingerprint' in body)) return undefined
  const tenantFingerprint = body.tenantFingerprint
  if (
    typeof tenantFingerprint !== 'string'
    || !TENANT_FINGERPRINT_PATTERN.test(tenantFingerprint)
  ) return undefined
  return { action, target: { tenantFingerprint } }
}

function readBatchRolloutAssignmentRequest(body: unknown): {
  action: StageRolloutAssignmentAction
} | undefined {
  if (typeof body !== 'object' || body === null || !('action' in body)) return undefined
  const action = body.action
  if (action !== 'inspect' && action !== 'enable' && action !== 'disable') return undefined
  if (!('scope' in body) || body.scope !== 'linked-ready') return undefined
  return { action }
}

export function buildMigrationApp(
  options: BuildMigrationAppOptions,
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true })

  app.get('/health', () => ({ status: 'ok' }))

  app.post('/migrate', async (request, reply) => {
    try {
      const migrations = await options.runMigrations()
      return { status: 'migrated', migrations }
    } catch (error) {
      const details = migrationFailureDetails(error)
      request.log.error(
        { migrationErrorCode: details.code },
        'Database migration failed',
      )
      return reply.code(500).send({
        status: 'migration_failed',
        error: details,
      })
    }
  })

  if (options.vitalMediaDeployment !== undefined) {
    const vitalMediaDeployment = options.vitalMediaDeployment
    app.addContentTypeParser(
      VITAL_MEDIA_BINARY_CONTENT_TYPE,
      { parseAs: 'buffer' },
      (_request, body, done) => done(null, body),
    )

    app.post('/stage/vital-media/preflight', async (request, reply) => {
      const body = request.body
      const allowWrite = typeof body === 'object'
        && body !== null
        && 'allowWrite' in body
        && body.allowWrite === true
      if (
        allowWrite
        && request.headers['x-fit-vital-media-confirmation']
          !== VITAL_MEDIA_APPLY_CONFIRMATION
      ) return reply.code(403).send({ status: 'apply_not_confirmed' })
      try {
        const result = await vitalMediaDeployment.preflight(allowWrite)
        return { status: 'vital_media_preflight_ready', ...result }
      } catch (error) {
        const code = error instanceof VitalMediaDeploymentError
          ? error.code
          : 'vital_media_preflight_failed'
        return reply.code(409).send({ status: 'vital_media_preflight_failed', code })
      }
    })

    app.put(
      '/stage/vital-media/object',
      { bodyLimit: VITAL_MEDIA_MAX_OBJECT_BYTES },
      async (request, reply) => {
        if (
          request.headers['x-fit-vital-media-confirmation']
            !== VITAL_MEDIA_APPLY_CONFIRMATION
        ) return reply.code(403).send({ status: 'apply_not_confirmed' })
        const file = readVitalMediaUpload(request.headers)
        if (file === undefined || !Buffer.isBuffer(request.body)) {
          return reply.code(400).send({ status: 'invalid_request' })
        }
        try {
          const result = await vitalMediaDeployment.upload(file, request.body)
          return {
            status: result.outcome === 'uploaded'
              ? 'vital_media_uploaded'
              : 'vital_media_skipped',
            versioning: result.versioning,
          }
        } catch (error) {
          const code = error instanceof VitalMediaDeploymentError
            ? error.code
            : 'vital_media_upload_failed'
          return reply.code(409).send({ status: 'vital_media_upload_failed', code })
        }
      },
    )

    app.post('/stage/vital-media/audit', async (request, reply) => {
      const files = readVitalMediaManifest(request.body)
      if (files === undefined) return reply.code(400).send({ status: 'invalid_request' })
      try {
        const report = await vitalMediaDeployment.audit(files)
        return { status: 'vital_media_audited', ...report }
      } catch (error) {
        const code = error instanceof VitalMediaDeploymentError
          ? error.code
          : 'vital_media_audit_failed'
        return reply.code(409).send({ status: 'vital_media_audit_failed', code })
      }
    })
  }

  if (options.runtimeDatabaseReadiness !== undefined) {
    const runtimeDatabaseReadiness = options.runtimeDatabaseReadiness
    app.post('/stage/runtime-database/readiness', async (request, reply) => {
      const sessionToken = request.headers['x-fit-pilot-session']
      const clientId = request.headers['x-fit-stage-client-id']
      if (
        typeof sessionToken !== 'string'
        || sessionToken.length === 0
        || typeof clientId !== 'string'
        || !UUID_PATTERN.test(clientId)
      ) {
        return reply.code(400).send({ status: 'invalid_request' })
      }
      const readiness = await runtimeDatabaseReadiness(sessionToken, clientId)
      if (readiness.ready) {
        return {
          status: 'runtime_database_ready',
          progressResponseBytes: readiness.progressResponseBytes,
        }
      }

      return reply.code(503).send({
        status: 'runtime_database_not_ready',
        check: readiness.check,
        category: readiness.category,
        code: readiness.code,
      })
    })
  }

  if (options.databaseReaderAccess !== undefined) {
    const databaseReaderAccess = options.databaseReaderAccess
    app.post('/stage/database-access/readers', async (request, reply) => {
      const accessRequest = readDatabaseReaderAccessRequest(request.body)
      if (accessRequest === undefined) {
        return reply.code(400).send({ status: 'invalid_request' })
      }

      try {
        await databaseReaderAccess.setAccess(
          accessRequest.action,
          accessRequest.databaseUsername,
        )
        return {
          status: accessRequest.action === 'grant'
            ? 'access_granted'
            : 'access_revoked',
        }
      } catch (error) {
        if (error instanceof StageDatabaseReaderNotReadyError) {
          return reply.code(409).send({ status: 'database_user_not_ready' })
        }
        return reply.code(500).send({ status: 'database_access_failed' })
      }
    })
  }

  if (options.rolloutAssignment !== undefined) {
    const rolloutAssignment = options.rolloutAssignment
    app.post('/stage/rollout-assignments/yandex/linked-ready', async (request, reply) => {
      const rolloutRequest = readBatchRolloutAssignmentRequest(request.body)
      if (rolloutRequest === undefined) {
        return reply.code(400).send({ status: 'invalid_request' })
      }

      try {
        const result = await rolloutAssignment.applyLinkedProfiles(rolloutRequest.action)
        return {
          status: rolloutRequest.action === 'inspect'
            ? 'rollout_batch_inspected'
            : rolloutRequest.action === 'enable'
              ? 'rollout_batch_enabled'
              : 'rollout_batch_disabled',
          ...result,
        }
      } catch (error) {
        if (error instanceof StageRolloutProfileNotReadyError) {
          return reply.code(409).send({ status: 'profiles_not_ready' })
        }
        return reply.code(500).send({ status: 'rollout_assignment_failed' })
      }
    })

    app.post('/stage/rollout-assignments/yandex', async (request, reply) => {
      const rolloutRequest = readRolloutAssignmentRequest(request.body)
      if (rolloutRequest === undefined) {
        return reply.code(400).send({ status: 'invalid_request' })
      }

      try {
        const result = await rolloutAssignment.apply(
          rolloutRequest.action,
          rolloutRequest.target,
        )
        return {
          status: rolloutRequest.action === 'inspect'
            ? 'rollout_inspected'
            : rolloutRequest.action === 'enable'
              ? 'rollout_enabled'
              : 'rollout_disabled',
          accountRole: result.accountRole,
          domainReady: result.domainReady,
          identityLinked: result.identityLinked,
          rolloutEnabled: result.rolloutEnabled,
        }
      } catch (error) {
        if (error instanceof StageRolloutProfileNotReadyError) {
          return reply.code(409).send({ status: 'profile_not_ready' })
        }
        return reply.code(500).send({ status: 'rollout_assignment_failed' })
      }
    })
  }

  if (options.stageTenantMigration !== undefined) {
    const tenantMigration = options.stageTenantMigration
    app.addContentTypeParser(
      STAGE_TENANT_BINARY_CONTENT_TYPE,
      { parseAs: 'buffer' },
      (_request, body, done) => done(null, body),
    )
    const registerTenantMigrationRoute = (
      path: '/stage/tenant-migration/dry-run' | '/stage/tenant-migration/apply',
      apply: boolean,
    ) => {
      app.post(
        path,
        { bodyLimit: STAGE_TENANT_ARTIFACT_LIMIT_BYTES },
        async (request, reply) => {
          const passphrase = readTenantMigrationPassphrase(
            request.headers['x-fit-tenant-migration-passphrase'],
          )
          if (passphrase === undefined) {
            return reply.code(400).send({ status: 'invalid_request' })
          }
          const mediaPolicy =
            request.headers['x-fit-tenant-migration-media-policy']
          if (
            mediaPolicy !== undefined
            && mediaPolicy !== 'allow-missing'
          ) {
            return reply.code(400).send({ status: 'invalid_request' })
          }
          if (
            apply
            && request.headers['x-fit-tenant-migration-confirmation']
              !== STAGE_TENANT_APPLY_CONFIRMATION
          ) {
            return reply.code(403).send({ status: 'apply_not_confirmed' })
          }

          try {
            const migrationEnvelope = Buffer.isBuffer(request.body)
              ? decodeStageTenantMigrationTransport(
                  request.body,
                  request.headers,
                )
              : request.body
            if (migrationEnvelope === undefined) {
              return reply.code(400).send({ status: 'invalid_request' })
            }
            const report = await tenantMigration.run(
              migrationEnvelope,
              passphrase,
              apply,
              mediaPolicy === 'allow-missing',
            )
            return {
              status: apply
                ? 'tenant_migration_applied'
                : 'tenant_migration_dry_run',
              tenantFingerprint: report.tenantFingerprint,
              tables: report.tables,
            }
          } catch (error) {
            return tenantMigrationFailure(reply, error)
          }
        },
      )
    }

    registerTenantMigrationRoute('/stage/tenant-migration/dry-run', false)
    registerTenantMigrationRoute('/stage/tenant-migration/apply', true)
  }

  if (options.pilotEnrollment !== undefined) {
    const pilotEnrollment = options.pilotEnrollment
    app.post('/pilot/enroll', async (request, reply) => {
      const enrollment = readEnrollmentRequest(request.body)
      if (enrollment === undefined) {
        return reply.code(400).send({ status: 'invalid_request' })
      }

      try {
        const identity = await pilotEnrollment.identityProvider
          .verifyAccessToken(enrollment.accessToken)
        const result = await pilotEnrollment.enroller.enroll(
          identity.subjectHash,
          enrollment.accountRole,
        )
        return {
          status: 'enrolled',
          accessMode: 'read_only',
          created: result.created,
        }
      } catch (error) {
        if (error instanceof YandexIdentityRejectedError) {
          return reply.code(401).send({ status: 'identity_rejected' })
        }
        if (error instanceof PilotEnrollmentConflictError) {
          return reply.code(409).send({ status: 'account_role_conflict' })
        }
        if (error instanceof YandexIdentityUnavailableError) {
          return reply.code(503).send({ status: 'enrollment_unavailable' })
        }
        return reply.code(500).send({ status: 'enrollment_failed' })
      }
    })
  }

  if (options.stageWorkoutFixture !== undefined) {
    const fixture = options.stageWorkoutFixture
    app.post('/stage/fixtures/workout-read-model', async (_request, reply) => {
      try {
        const result = await fixture.load()
        return {
          status: 'fixture_ready',
          seededTrainerCount: result.seededTrainerCount,
          session: {
            token: result.sessionToken,
            expiresAt: result.sessionExpiresAt,
            clientId: result.clientId,
          },
          clientSession: {
            token: result.clientSessionToken,
            expiresAt: result.clientSessionExpiresAt,
          },
          mediaSession: {
            token: result.mediaSessionToken,
            expiresAt: result.mediaSessionExpiresAt,
          },
        }
      } catch {
        return reply.code(500).send({ status: 'fixture_failed' })
      }
    })
  }

  return app
}
