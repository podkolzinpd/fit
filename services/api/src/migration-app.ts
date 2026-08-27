import Fastify, { type FastifyInstance } from 'fastify'

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
  ) => Promise<RuntimeDomainReadinessResult>
  stageWorkoutFixture?: StageWorkoutFixtureLoader
}

const DATABASE_USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,62}$/

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
      if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
        return reply.code(400).send({ status: 'invalid_request' })
      }
      const readiness = await runtimeDatabaseReadiness(sessionToken)
      if (readiness.ready) return { status: 'runtime_database_ready' }

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
