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

interface PilotEnrollmentOptions {
  enroller: PilotEnroller
  identityProvider: YandexIdentityProvider
}

interface BuildMigrationAppOptions {
  logger?: boolean
  pilotEnrollment?: PilotEnrollmentOptions
  runMigrations: () => Promise<readonly string[]>
  stageWorkoutFixture?: StageWorkoutFixtureLoader
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
        }
      } catch {
        return reply.code(500).send({ status: 'fixture_failed' })
      }
    })
  }

  return app
}
