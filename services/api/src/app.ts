import Fastify, { type FastifyInstance } from 'fastify'

import {
  readBearerToken,
  YandexIdentityRejectedError,
  type YandexIdentityProvider,
  YandexIdentityUnavailableError,
} from './auth/yandex-identity.js'
import { PilotAccessDeniedError } from './db/yandex-pilot-transaction.js'
import type { DatabaseConnection, DatabasePool } from './db/types.js'
import type { PilotProfileReader } from './pilot-profile-reader.js'

interface BuildAppOptions {
  databasePool?: DatabasePool
  identityProvider?: YandexIdentityProvider
  pilotProfileReader?: PilotProfileReader
  logger?: boolean
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  })

  app.get('/health', () => ({ status: 'ok' }))

  app.get('/ready', async (_request, reply) => {
    if (options.databasePool === undefined) {
      return reply.code(503).send({ status: 'not_ready' })
    }

    let connection: DatabaseConnection | undefined
    try {
      connection = await options.databasePool.connect()
      await connection.query('select 1')
      return { status: 'ready' }
    } catch {
      return reply.code(503).send({ status: 'not_ready' })
    } finally {
      connection?.release()
    }
  })

  app.get('/v1/profile', async (request, reply) => {
    const token = readBearerToken(request.headers.authorization)
    if (token === undefined) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      options.identityProvider === undefined ||
      options.pilotProfileReader === undefined
    ) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }

    let subjectHash: string
    try {
      const identity = await options.identityProvider.verifyAccessToken(token)
      subjectHash = identity.subjectHash
    } catch (error) {
      if (error instanceof YandexIdentityRejectedError) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
      if (error instanceof YandexIdentityUnavailableError) {
        return reply.code(503).send({ error: 'service_unavailable' })
      }
      throw error
    }

    try {
      const profile = await options.pilotProfileReader.readProfile(subjectHash)
      if (profile === undefined) {
        return reply.code(404).send({ error: 'profile_not_found' })
      }
      return profile
    } catch (error) {
      if (error instanceof PilotAccessDeniedError) {
        return reply.code(403).send({ error: 'pilot_access_denied' })
      }
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  })

  if (options.databasePool !== undefined) {
    app.addHook('onClose', async () => options.databasePool?.end())
  }

  return app
}
