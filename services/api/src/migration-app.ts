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
import { TenantMigrationArtifactError } from './tenant-migration/bundle.js'
import { TenantMigrationError } from './tenant-migration/engine.js'
import type { StageTenantMigrationRunner } from './tenant-migration/stage-runner.js'

interface PilotEnrollmentOptions {
  enroller: PilotEnroller
  identityProvider: YandexIdentityProvider
}

interface BuildMigrationAppOptions {
  databaseReaderAccess?: StageDatabaseReaderAccessManager
  logger?: boolean
  pilotEnrollment?: PilotEnrollmentOptions
  runMigrations: () => Promise<readonly string[]>
  runtimeDatabaseReadiness?: (
    sessionToken: string,
    clientId: string,
  ) => Promise<RuntimeDomainReadinessResult>
  stageTenantMigration?: StageTenantMigrationRunner
  stageWorkoutFixture?: StageWorkoutFixtureLoader
}

const DATABASE_USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,62}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STAGE_TENANT_APPLY_CONFIRMATION = 'APPLY_TENANT_TO_YANDEX_STAGE'
const STAGE_TENANT_ARTIFACT_LIMIT_BYTES = 3 * 1024 * 1024
const SAFE_TENANT_MIGRATION_ERROR_PATTERN = /^[a-z0-9_.:-]{1,96}$/

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

export function buildMigrationApp(
  options: BuildMigrationAppOptions,
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true })

  app.get('/health', () => ({ status: 'ok' }))

  app.post('/migrate', async (_request, reply) => {
    try {
      const migrations = await options.runMigrations()
      return { status: 'migrated', migrations }
    } catch {
      return reply.code(500).send({ status: 'migration_failed' })
    }
  })

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

  if (options.stageTenantMigration !== undefined) {
    const tenantMigration = options.stageTenantMigration
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
          if (
            apply
            && request.headers['x-fit-tenant-migration-confirmation']
              !== STAGE_TENANT_APPLY_CONFIRMATION
          ) {
            return reply.code(403).send({ status: 'apply_not_confirmed' })
          }

          try {
            const report = await tenantMigration.run(
              request.body,
              passphrase,
              apply,
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
        }
      } catch {
        return reply.code(500).send({ status: 'fixture_failed' })
      }
    })
  }

  return app
}
