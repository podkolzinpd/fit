import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'

import {
  readBearerToken,
  YandexIdentityRejectedError,
  type YandexIdentityProvider,
  YandexIdentityUnavailableError,
} from './auth/yandex-identity.js'
import {
  YandexOAuthCodeRejectedError,
  type YandexOAuthCodeProvider,
  YandexOAuthCodeUnavailableError,
} from './auth/yandex-oauth-code.js'
import {
  PilotAccessDeniedError,
  PilotSessionInvalidError,
} from './db/yandex-pilot-transaction.js'
import type { DatabaseConnection, DatabasePool } from './db/types.js'
import type { PilotClientsReader } from './pilot-clients-reader.js'
import type { PilotConnectionsReader } from './pilot-connections-reader.js'
import type { PilotProfileReader } from './pilot-profile-reader.js'
import type { PilotSessionIssuer } from './pilot-session.js'

interface BuildAppOptions {
  allowedOrigins?: readonly string[]
  databasePool?: DatabasePool
  identityProvider?: YandexIdentityProvider
  oauthCodeProvider?: YandexOAuthCodeProvider
  pilotClientsReader?: PilotClientsReader
  pilotConnectionsReader?: PilotConnectionsReader
  pilotProfileReader?: PilotProfileReader
  pilotSessionIssuer?: PilotSessionIssuer
  logger?: boolean
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  })
  const allowedOrigins = new Set(options.allowedOrigins ?? [])

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      return reply.code(403).send({ error: 'origin_not_allowed' })
    }
    if (origin !== undefined && allowedOrigins.has(origin)) {
      reply
        .header('access-control-allow-origin', origin)
        .header('access-control-allow-methods', 'GET, POST, OPTIONS')
        .header(
          'access-control-allow-headers',
          'authorization, content-type, x-fit-pilot-session',
        )
        .header('vary', 'Origin')
    }
    if (request.method === 'OPTIONS') {
      if (origin === undefined) {
        return reply.code(403).send({ error: 'origin_not_allowed' })
      }
      return reply.code(204).send()
    }
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

  async function sendPilotProfile(token: string, reply: FastifyReply) {
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
      return reply.send(profile)
    } catch (error) {
      if (error instanceof PilotAccessDeniedError) {
        return reply.code(403).send({ error: 'pilot_access_denied' })
      }
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  }

  app.get('/v1/profile', async (request, reply) => {
    const token = readBearerToken(request.headers.authorization)
    if (token === undefined) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    return sendPilotProfile(token, reply)
  })

  app.post('/v1/auth/yandex/pilot', async (request, reply) => {
    const body = request.body
    if (typeof body !== 'object' || body === null || !('code' in body) || !('codeVerifier' in body)) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const code = body.code
    const codeVerifier = body.codeVerifier
    if (
      typeof code !== 'string' || code.length === 0 || code.length > 2_048 ||
      typeof codeVerifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    if (
      options.oauthCodeProvider === undefined
      || options.identityProvider === undefined
      || options.pilotSessionIssuer === undefined
    ) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }

    let token: string
    try {
      token = await options.oauthCodeProvider.exchangeCode(code, codeVerifier)
    } catch (error) {
      if (error instanceof YandexOAuthCodeRejectedError) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
      if (error instanceof YandexOAuthCodeUnavailableError) {
        return reply.code(503).send({ error: 'service_unavailable' })
      }
      throw error
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
      const session = await options.pilotSessionIssuer.issue(subjectHash)
      if (session === undefined) {
        return reply.code(404).send({ error: 'profile_not_found' })
      }
      return reply.header('cache-control', 'no-store').send(session)
    } catch (error) {
      if (error instanceof PilotAccessDeniedError) {
        return reply.code(403).send({ error: 'pilot_access_denied' })
      }
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  })

  app.get('/v1/clients', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (options.pilotClientsReader === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }

    try {
      return reply
        .header('cache-control', 'no-store')
        .send(await options.pilotClientsReader.readClients(sessionToken))
    } catch (error) {
      if (error instanceof PilotSessionInvalidError) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  })

  app.get('/v1/connections', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (options.pilotConnectionsReader === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }

    try {
      return reply
        .header('cache-control', 'no-store')
        .send(await options.pilotConnectionsReader.readConnections(sessionToken))
    } catch (error) {
      if (error instanceof PilotSessionInvalidError) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  })

  if (options.databasePool !== undefined) {
    app.addHook('onClose', async () => options.databasePool?.end())
  }

  return app
}
