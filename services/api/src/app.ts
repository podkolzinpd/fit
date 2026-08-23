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
import { PilotConnectionCommandError } from './connection-commands.js'
import type { DatabaseConnection, DatabasePool } from './db/types.js'
import type { PilotClientsReader } from './pilot-clients-reader.js'
import type { PilotConnectionsReader } from './pilot-connections-reader.js'
import type { PilotConnectionsWriter } from './pilot-connections-writer.js'
import type { PilotProfileReader } from './pilot-profile-reader.js'
import type { PilotSessionIssuer } from './pilot-session.js'
import type { PilotTrainingDataReader } from './pilot-training-data-reader.js'
import type { PilotWorkoutsWriter } from './pilot-workouts-writer.js'
import {
  readExpectedVersion,
  readSavePlannedWorkoutRequest,
} from './planned-workout-request.js'
import { PilotWorkoutCommandError } from './workout-commands.js'

interface BuildAppOptions {
  allowedOrigins?: readonly string[]
  databasePool?: DatabasePool
  identityProvider?: YandexIdentityProvider
  oauthCodeProvider?: YandexOAuthCodeProvider
  pilotClientsReader?: PilotClientsReader
  pilotConnectionsReader?: PilotConnectionsReader
  pilotConnectionsWriter?: PilotConnectionsWriter
  pilotProfileReader?: PilotProfileReader
  pilotSessionIssuer?: PilotSessionIssuer
  pilotTrainingDataReader?: PilotTrainingDataReader
  pilotWorkoutsWriter?: PilotWorkoutsWriter
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
        .header('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS')
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

  app.get('/v1/training-data', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (options.pilotTrainingDataReader === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }

    try {
      return reply
        .header('cache-control', 'no-store')
        .send(await options.pilotTrainingDataReader.readTrainingData(sessionToken))
    } catch (error) {
      if (error instanceof PilotSessionInvalidError) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  })

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  async function sendPilotCommand<Result>(
    reply: FastifyReply,
    work: () => Promise<Result>,
    send: (result: Result) => unknown,
  ) {
    try {
      return send(await work())
    } catch (error) {
      if (error instanceof PilotSessionInvalidError) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
      if (error instanceof PilotConnectionCommandError) {
        if (error.failure === 'forbidden') {
          return reply.code(403).send({ error: 'action_not_allowed' })
        }
        if (error.failure === 'not_found') {
          return reply.code(404).send({ error: 'resource_not_found' })
        }
        if (error.failure === 'conflict') {
          return reply.code(409).send({ error: 'conflict' })
        }
        return reply.code(422).send({ error: 'action_not_allowed' })
      }
      if (error instanceof PilotWorkoutCommandError) {
        if (error.failure === 'forbidden') {
          return reply.code(403).send({ error: 'action_not_allowed' })
        }
        if (error.failure === 'not_found') {
          return reply.code(404).send({ error: 'resource_not_found' })
        }
        if (error.failure === 'conflict') {
          return reply.code(409).send({ error: 'version_conflict' })
        }
        return reply.code(422).send({ error: 'invalid_workout' })
      }
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  }

  app.post('/v1/workouts', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    const command = readSavePlannedWorkoutRequest(request.body, null)
    if (command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.savePlanned(
        sessionToken,
        command.draft,
        command.expectedVersion,
      ),
      (saved) => reply
        .header('cache-control', 'no-store')
        .code(201)
        .send({ workout: saved }),
    )
  })

  app.put('/v1/workouts/:workoutId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof workoutId !== 'string' || !uuidPattern.test(workoutId)) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const command = readSavePlannedWorkoutRequest(request.body, workoutId)
    if (command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.savePlanned(
        sessionToken,
        command.draft,
        command.expectedVersion,
      ),
      (saved) => reply
        .header('cache-control', 'no-store')
        .send({ workout: saved }),
    )
  })

  app.delete('/v1/workouts/:workoutId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    const expectedVersion = readExpectedVersion(request.body)
    if (
      typeof workoutId !== 'string'
      || !uuidPattern.test(workoutId)
      || expectedVersion === undefined
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.deletePlanned(sessionToken, workoutId, expectedVersion),
      (version) => reply
        .header('cache-control', 'no-store')
        .send({ workout: { id: workoutId, version } }),
    )
  })

  app.post('/v1/invitations', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const body = request.body
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof body !== 'object'
      || body === null
      || !('clientId' in body)
      || !('targetRole' in body)
      || typeof body.clientId !== 'string'
      || !uuidPattern.test(body.clientId)
      || (body.targetRole !== 'client' && body.targetRole !== 'trainer')
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotConnectionsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    const clientId = body.clientId
    const targetRole = body.targetRole

    return sendPilotCommand(
      reply,
      () => writer.createInvitation(sessionToken, clientId, targetRole),
      (invitation) => reply
        .header('cache-control', 'no-store')
        .code(201)
        .send({ invitation }),
    )
  })

  app.post('/v1/invitations/claim', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const body = request.body
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof body !== 'object'
      || body === null
      || !('code' in body)
      || typeof body.code !== 'string'
      || !/^[A-Za-z0-9]{12}$/.test(body.code.trim())
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotConnectionsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    const code = body.code.trim().toUpperCase()

    return sendPilotCommand(
      reply,
      () => writer.claimInvitation(sessionToken, code),
      (clientId) => reply
        .header('cache-control', 'no-store')
        .send({ clientId }),
    )
  })

  app.delete('/v1/invitations/:invitationId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { invitationId } = request.params as { invitationId?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof invitationId !== 'string' || !uuidPattern.test(invitationId)) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotConnectionsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }

    return sendPilotCommand(
      reply,
      () => writer.revokeInvitation(sessionToken, invitationId),
      () => reply.code(204).send(),
    )
  })

  app.delete('/v1/clients/:clientId/trainers/:trainerId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId, trainerId } = request.params as {
      clientId?: unknown
      trainerId?: unknown
    }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof clientId !== 'string'
      || !uuidPattern.test(clientId)
      || typeof trainerId !== 'string'
      || !uuidPattern.test(trainerId)
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotConnectionsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }

    return sendPilotCommand(
      reply,
      () => writer.removeTrainer(
        sessionToken,
        clientId,
        trainerId,
      ),
      () => reply.code(204).send(),
    )
  })

  app.delete('/v1/clients/:clientId/memberships/me', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId } = request.params as { clientId?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof clientId !== 'string' || !uuidPattern.test(clientId)) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotConnectionsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }

    return sendPilotCommand(
      reply,
      () => writer.leaveClient(sessionToken, clientId),
      () => reply.code(204).send(),
    )
  })

  if (options.databasePool !== undefined) {
    app.addHook('onClose', async () => options.databasePool?.end())
  }

  return app
}
