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
import { AppFeedbackCommandError } from './app-feedback-command.js'
import { readAppFeedbackRequest } from './app-feedback-request.js'
import { AssistantStateError } from './assistant-state.js'
import {
  readAssistantActionRequest,
  readAssistantConversationRequest,
  readAssistantTurnRequest,
  readAssistantVersionRequest,
} from './assistant-state-request.js'
import { PushNotificationCommandError } from './push-notifications-command.js'
import {
  readNotificationPreferenceRequest,
  readPushNotificationKind,
  readPushSubscriptionRequest,
} from './push-notifications-request.js'
import { PilotConnectionCommandError } from './connection-commands.js'
import { PilotDomainCommandError } from './domain-commands.js'
import {
  readArchiveRequest,
  readCreateClientCardDraft,
  readClientPreferencesRequest,
  readCustomExerciseDraft,
  readVersionedClientCardRequest,
  readVersionedCustomExerciseRequest,
} from './domain-request.js'
import type { DatabasePool } from './db/types.js'
import {
  inspectDatabaseReadiness,
  safeDatabaseErrorDiagnostics,
} from './db/database-readiness.js'
import type { PilotClientsReader } from './pilot-clients-reader.js'
import type { PilotAppFeedbackWriter } from './pilot-app-feedback-writer.js'
import type { PilotAssistantState } from './pilot-assistant-state.js'
import type { PilotAssistantTurnRunner } from './pilot-assistant-turn.js'
import type { PilotPushNotifications } from './pilot-push-notifications.js'
import type { PilotConnectionsReader } from './pilot-connections-reader.js'
import type { PilotConnectionsWriter } from './pilot-connections-writer.js'
import type { PilotDomainWriter } from './pilot-domain-writer.js'
import type { PilotProfileReader } from './pilot-profile-reader.js'
import type { PilotSessionIssuer } from './pilot-session.js'
import type { PilotTrainingDataReader } from './pilot-training-data-reader.js'
import type { PilotProgressData } from './progress-data.js'
import type { PilotWorkoutsWriter } from './pilot-workouts-writer.js'
import type { PilotWorkoutParser } from './pilot-workout-parser.js'
import {
  PilotTrainingSummaryError,
  type PilotTrainingSummaryGenerator,
  type PilotTrainingSummaryReader,
} from './training-summary.js'
import {
  readLiveCommentRequest,
  readLiveExerciseRequest,
  readLiveOperationRequest,
  readLiveReorderRequest,
  readLiveSetRequest,
} from './live-workout-request.js'
import {
  readExpectedVersion,
  readSavePlannedWorkoutRequest,
} from './planned-workout-request.js'
import {
  readRescheduleWorkoutRequest,
  readWorkoutCommentRequest,
} from './workout-lifecycle-request.js'
import {
  readWorkoutFeedbackRequest,
  readWorkoutQuestionRequest,
  readWorkoutTrainerResponseRequest,
} from './post-workout-request.js'
import { PilotWorkoutCommandError } from './workout-commands.js'
import { WorkoutParseError, type LegacyWorkoutParser } from './legacy-workout-parser.js'
import { HttpError as SummaryModelError } from './legacy-summary/index.js'
import { readAssistantProgressRequest } from './assistant-progress-request.js'
import {
  readVersionedGoalRequest,
  readVersionedGoalStageRequest,
  readVersionedMetricRequest,
  readVersionedProgressRequest,
} from './progress-request.js'

export type LegacySummaryHandler = (request: Request) => Promise<Response>

interface BuildAppOptions {
  allowedOrigins?: readonly string[]
  databasePool?: DatabasePool
  identityProvider?: YandexIdentityProvider
  oauthCodeProvider?: YandexOAuthCodeProvider
  pilotAppFeedbackWriter?: PilotAppFeedbackWriter
  pilotAssistantState?: PilotAssistantState
  pilotAssistantTurnRunner?: PilotAssistantTurnRunner
  pilotPushNotifications?: PilotPushNotifications
  pilotClientsReader?: PilotClientsReader
  pilotConnectionsReader?: PilotConnectionsReader
  pilotConnectionsWriter?: PilotConnectionsWriter
  pilotDomainWriter?: PilotDomainWriter
  pilotProfileReader?: PilotProfileReader
  pilotSessionIssuer?: PilotSessionIssuer
  pilotTrainingDataReader?: PilotTrainingDataReader
  pilotProgressData?: PilotProgressData
  pilotWorkoutsWriter?: PilotWorkoutsWriter
  pilotWorkoutParser?: PilotWorkoutParser
  pilotTrainingSummaryGenerator?: PilotTrainingSummaryGenerator
  pilotTrainingSummaryReader?: PilotTrainingSummaryReader
  legacyWorkoutParser?: LegacyWorkoutParser
  legacySummaryHandler?: LegacySummaryHandler
  logger?: boolean
  releaseId?: string
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  })
  const allowedOrigins = new Set(options.allowedOrigins ?? [])

  app.addHook('onRequest', async (request, reply) => {
    if (options.releaseId !== undefined) {
      reply.header('x-fit-release-id', options.releaseId)
    }
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
          'authorization, content-type, x-fit-pilot-session, x-supabase-authorization',
        )
        .header(
          'access-control-expose-headers',
          'x-fit-release-id, x-fit-error-category, x-fit-error-code',
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

  app.get('/health', () => ({
    status: 'ok',
    ...(options.releaseId === undefined ? {} : { releaseId: options.releaseId }),
  }))

  app.post('/v1/legacy/parse-workout', async (request, reply) => {
    const actorToken = request.headers['x-supabase-authorization']
    if (typeof actorToken !== 'string' || !actorToken.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (options.legacyWorkoutParser === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    try {
      const body = request.body as { kind?: unknown } | null
      if (body?.kind === 'goal_criteria' && options.legacyWorkoutParser.suggest === undefined) return reply.code(503).send({ error: 'service_unavailable' })
      return reply.send(body?.kind === 'goal_criteria'
        ? await options.legacyWorkoutParser.suggest!(actorToken.slice('Bearer '.length), request.body)
        : await options.legacyWorkoutParser.parse(actorToken.slice('Bearer '.length), request.body))
    } catch (error) {
      if (error instanceof WorkoutParseError) {
        if (error.code === 'invalid_request') {
          return reply.code(400).send({ error: { code: error.code, message: 'Некорректный запрос разбора тренировки' } })
        }
        if (error.code === 'empty_catalog') {
          return reply.code(400).send({ error: { code: error.code, message: 'Каталог упражнений пуст' } })
        }
        if (error.code === 'llm_unavailable') {
          return reply.code(502).send({ error: { code: error.code, message: 'Модель временно недоступна' } })
        }
        if (error.code === 'parse_failed') {
          return reply.code(502).send({ error: { code: error.code, message: 'Не удалось разобрать диктовку' } })
        }
        return reply.code(error.status).send({ error: error.code })
      }
      throw error
    }
  })

  app.post('/v1/legacy/summarize-client-training', async (request, reply) => {
    const authorization = request.headers['x-supabase-authorization']
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'authentication_required' })
    }
    if (options.legacySummaryHandler === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return forwardLegacySummary(authorization, request.body, reply)
  })

  // Первый assistant endpoint намеренно не является универсальным tool runner.
  // Сводка read-only, поэтому её можно безопасно обкатать раньше write-действий.
  app.post('/v1/assistant/progress-summary', async (request, reply) => {
    const authorization = request.headers['x-supabase-authorization']
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'authentication_required' })
    }
    const command = readAssistantProgressRequest(request.body)
    if (command === undefined) return reply.code(400).send({ error: 'invalid_progress_request' })
    if (options.legacySummaryHandler === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return forwardLegacySummary(authorization, {
      client_id: command.clientId,
      period_start: command.periodStart,
      period_end: command.periodEnd,
      force: command.force,
    }, reply)
  })

  app.post('/v1/assistant/yandex/parse-workout', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (options.pilotWorkoutParser === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    try {
      return reply.header('cache-control', 'no-store')
        .send(await options.pilotWorkoutParser.parse(sessionToken, request.body))
    } catch (error) {
      if (error instanceof PilotSessionInvalidError) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
      if (error instanceof WorkoutParseError) {
        return reply.code(error.status).send({ error: error.code })
      }
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  })

  app.get('/v1/clients/:clientId/training-summaries', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId } = request.params as { clientId?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof clientId !== 'string' || !uuidPattern.test(clientId)) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    if (options.pilotTrainingSummaryReader === undefined) {
      return reply.header('x-fit-error-code', 'training_summary_reader_not_configured')
        .code(503).send({ error: 'service_unavailable' })
    }
    try {
      const summaries = await options.pilotTrainingSummaryReader.list(sessionToken, clientId)
      return reply.header('cache-control', 'no-store').send({ summaries })
    } catch (error) {
      return sendPilotSummaryError(error, reply)
    }
  })

  app.post('/v1/clients/:clientId/training-summaries/generate', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId } = request.params as { clientId?: unknown }
    const command = readAssistantProgressRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof clientId !== 'string' || !uuidPattern.test(clientId)
      || command === undefined || command.clientId !== clientId) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    if (options.pilotTrainingSummaryGenerator === undefined) {
      return reply.header('x-fit-error-code', 'training_summary_generation_not_configured')
        .code(503).send({ error: 'service_unavailable' })
    }
    try {
      return reply.header('cache-control', 'no-store').send(
        await options.pilotTrainingSummaryGenerator.generate(sessionToken, command),
      )
    } catch (error) {
      return sendPilotSummaryError(error, reply)
    }
  })

  function sendPilotSummaryError(error: unknown, reply: FastifyReply) {
    if (error instanceof PilotSessionInvalidError) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (error instanceof PilotTrainingSummaryError) {
      return reply.header('x-fit-error-code', error.code)
        .code(error.status).send({ error: error.code })
    }
    if (error instanceof SummaryModelError) {
      return reply.header('x-fit-error-code', error.message)
        .code(error.status).send({ error: error.message })
    }
    const code = error instanceof Error ? error.message : 'service_unavailable'
    const modelCodes = new Set([
      'yandex_cloud_timeout', 'yandex_cloud_rate_limited',
      'yandex_cloud_unavailable', 'yandex_cloud_access_rejected',
      'yandex_cloud_request_rejected', 'yandex_cloud_invalid_json',
      'yandex_cloud_invalid_summary', 'yandex_cloud_empty_response',
      'yandex_cloud_quality_check_failed',
    ])
    if (modelCodes.has(code)) {
      return reply.header('x-fit-error-code', code).code(502).send({ error: code })
    }
    return reply.code(503).send({ error: 'service_unavailable' })
  }

  async function forwardLegacySummary(authorization: string, body: unknown, reply: FastifyReply) {
    if (options.legacySummaryHandler === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    const response = await options.legacySummaryHandler(new Request(
      'http://legacy.internal/summarize-client-training',
      {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ))
    const errorCode = response.headers.get('x-fit-error-code')
    if (errorCode !== null) reply.header('x-fit-error-code', errorCode)
    return reply.code(response.status).type('application/json').send(await response.text())
  }

  app.get('/ready', async (_request, reply) => {
    if (options.databasePool === undefined) {
      return reply.code(503).send({ status: 'not_ready' })
    }

    const readiness = await inspectDatabaseReadiness(options.databasePool)
    if (readiness.ready) return { status: 'ready' }

    app.log.warn(
      {
        databaseErrorCategory: readiness.category,
        databaseErrorCode: readiness.code,
      },
      'Database readiness check failed',
    )
    return reply.code(503).send({ status: 'not_ready' })
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
    const { archived: archivedQuery } = request.query as { archived?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (options.pilotClientsReader === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    if (archivedQuery !== undefined && archivedQuery !== 'true' && archivedQuery !== 'false') {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const archived = archivedQuery === 'true'

    try {
      return reply
        .header('cache-control', 'no-store')
        .send(await options.pilotClientsReader.readClients(sessionToken, archived))
    } catch (error) {
      if (error instanceof PilotSessionInvalidError) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
      return sendSafeDatabaseFailure(reply, error, 'Pilot clients query failed')
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
      return sendSafeDatabaseFailure(reply, error, 'Pilot connections query failed')
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
      return sendSafeDatabaseFailure(reply, error, 'Pilot training data query failed')
    }
  })

  app.get('/v1/clients/:clientId/progress', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId } = request.params as { clientId?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof clientId !== 'string' || !uuidPattern.test(clientId)) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) {
      return reply
        .header('x-fit-error-category', 'configuration')
        .header('x-fit-error-code', 'PILOT_PROGRESS_DATA_UNAVAILABLE')
        .code(503)
        .send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(reply, () => data.readBundle(sessionToken, clientId),
      (result) => reply.header('cache-control', 'no-store').send(result))
  })

  app.get('/v1/clients/:clientId/progress/regularity', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId } = request.params as { clientId?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof clientId !== 'string' || !uuidPattern.test(clientId)) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply, () => data.readRegularity(sessionToken, clientId),
      (result) => reply.header('cache-control', 'no-store').send({ regularity: result }))
  })

  app.get('/v1/clients/:clientId/progress/running', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId } = request.params as { clientId?: unknown }
    const { from, to } = request.query as { from?: unknown; to?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof clientId !== 'string' || !uuidPattern.test(clientId)
      || !validDate(from) || !validDate(to) || from > to) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply, () => data.readRunning(sessionToken, clientId, from, to),
      (result) => reply.header('cache-control', 'no-store').send({ sessions: result }))
  })

  function readProgressCursor(query: Record<string, unknown>) {
    const limitValue = query.limit === undefined ? 20 : Number(query.limit)
    const completedAt = query.beforeCompletedAt
    const workoutId = query.beforeWorkoutId
    const cursorAbsent = completedAt === undefined && workoutId === undefined
    const cursorValid = typeof completedAt === 'string'
      && Number.isFinite(Date.parse(completedAt))
      && typeof workoutId === 'string' && uuidPattern.test(workoutId)
    return Number.isSafeInteger(limitValue) && limitValue >= 1 && limitValue <= 50
      && (cursorAbsent || cursorValid)
      ? { limit: limitValue, cursor: cursorAbsent
        ? { completedAt: null, workoutId: null }
        : { completedAt: completedAt as string, workoutId: workoutId as string } }
      : undefined
  }

  app.get('/v1/clients/:clientId/progress/exercises/:exerciseRef', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId, exerciseRef } = request.params as { clientId?: unknown; exerciseRef?: unknown }
    const page = readProgressCursor(request.query as Record<string, unknown>)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof clientId !== 'string' || !uuidPattern.test(clientId)
      || typeof exerciseRef !== 'string' || exerciseRef.trim().length === 0
      || exerciseRef.length > 300 || page === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.readExercise(sessionToken, clientId, exerciseRef, page.limit, page.cursor),
      (result) => reply.header('cache-control', 'no-store').send(result))
  })

  app.get('/v1/clients/:clientId/workout-chronicle', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId } = request.params as { clientId?: unknown }
    const page = readProgressCursor(request.query as Record<string, unknown>)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof clientId !== 'string' || !uuidPattern.test(clientId) || page === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.readChronicle(sessionToken, clientId, page.limit, page.cursor),
      (result) => reply.header('cache-control', 'no-store').send(result))
  })

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  const validDate = (value: unknown): value is string => {
    if (typeof value !== 'string' || !datePattern.test(value)) return false
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }

  function sendSafeDatabaseFailure(
    reply: FastifyReply,
    error: unknown,
    message: string,
  ) {
    const diagnostics = safeDatabaseErrorDiagnostics(error)
    app.log.warn(
      {
        databaseErrorCategory: diagnostics.category,
        databaseErrorCode: diagnostics.code,
      },
      message,
    )
    return reply
      .header('x-fit-error-category', diagnostics.category)
      .header('x-fit-error-code', diagnostics.code)
      .code(503)
      .send({ error: 'service_unavailable' })
  }

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
      if (error instanceof AppFeedbackCommandError) {
        return reply
          .code(error.failure === 'forbidden' ? 403 : 422)
          .send({ error: error.failure === 'forbidden'
            ? 'action_not_allowed'
            : 'invalid_feedback' })
      }
      if (error instanceof AssistantStateError) {
        if (error.failure === 'forbidden') {
          return reply.code(403).send({ error: 'action_not_allowed' })
        }
        if (error.failure === 'not_found') {
          return reply.code(404).send({ error: 'resource_not_found' })
        }
        if (error.failure === 'conflict') {
          return reply.code(409).send({ error: 'version_conflict' })
        }
        return reply.code(422).send({ error: 'invalid_assistant_state' })
      }
      if (error instanceof PushNotificationCommandError) {
        return reply
          .code(error.failure === 'forbidden' ? 403 : 422)
          .send({ error: error.failure === 'forbidden'
            ? 'action_not_allowed'
            : 'invalid_push_notifications' })
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
      if (error instanceof PilotDomainCommandError) {
        if (error.failure === 'forbidden') {
          return reply.code(403).send({ error: 'action_not_allowed' })
        }
        if (error.failure === 'not_found') {
          return reply.code(404).send({ error: 'resource_not_found' })
        }
        if (error.failure === 'conflict') {
          return reply.code(409).send({ error: 'version_conflict' })
        }
        return reply.code(422).send({ error: 'invalid_domain_data' })
      }
      if (error instanceof PilotWorkoutCommandError) {
        if (error.failure === 'active') {
          return reply.code(409).send({ error: 'active_workout_exists' })
        }
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
      return sendSafeDatabaseFailure(reply, error, 'Pilot command failed')
    }
  }

  app.post('/v1/app-feedback', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const draft = readAppFeedbackRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (draft === undefined) return reply.code(400).send({ error: 'invalid_request' })
    const writer = options.pilotAppFeedbackWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.submit(sessionToken, draft),
      (feedbackId) => reply
        .header('cache-control', 'no-store')
        .code(201)
        .send({ feedback: { id: feedbackId } }),
    )
  })

  app.get('/v1/assistant/conversations', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    const state = options.pilotAssistantState
    if (state === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => state.listConversations(sessionToken),
      (conversations) => reply
        .header('cache-control', 'no-store')
        .send({ conversations }),
    )
  })

  app.post('/v1/assistant/conversations', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const draft = readAssistantConversationRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (draft === undefined) return reply.code(400).send({ error: 'invalid_request' })
    const state = options.pilotAssistantState
    if (state === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => state.createConversation(sessionToken, draft.title),
      (conversation) => reply
        .header('cache-control', 'no-store')
        .code(201)
        .send({ conversation }),
    )
  })

  app.post('/v1/assistant/turn', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const command = readAssistantTurnRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (command === undefined) return reply.code(400).send({ error: 'invalid_request' })
    const runner = options.pilotAssistantTurnRunner
    if (runner === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => runner.runTurn(sessionToken, command),
      (result) => reply.header('cache-control', 'no-store').send(result),
    )
  })

  app.get('/v1/assistant/conversations/:conversationId/messages', async (
    request,
    reply,
  ) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { conversationId } = request.params as { conversationId?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof conversationId !== 'string' || !uuidPattern.test(conversationId)) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const state = options.pilotAssistantState
    if (state === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => state.listMessages(sessionToken, conversationId),
      (messages) => reply.header('cache-control', 'no-store').send({ messages }),
    )
  })

  app.get('/v1/assistant/actions', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { conversationId: rawConversationId } = request.query as {
      conversationId?: unknown
    }
    const conversationId = rawConversationId === undefined
      ? null
      : rawConversationId
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (conversationId !== null
      && (typeof conversationId !== 'string' || !uuidPattern.test(conversationId))) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const state = options.pilotAssistantState
    if (state === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => state.listActions(sessionToken, conversationId),
      (actions) => reply.header('cache-control', 'no-store').send({ actions }),
    )
  })

  app.post('/v1/assistant/actions/:actionId/apply', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { actionId } = request.params as { actionId?: unknown }
    const command = readAssistantActionRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof actionId !== 'string' || !uuidPattern.test(actionId)
      || command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const state = options.pilotAssistantState
    if (state === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => state.applyAction(
        sessionToken,
        actionId,
        command.input,
        command.expectedVersion,
      ),
      (result) => reply.header('cache-control', 'no-store').send({ result }),
    )
  })

  app.post('/v1/assistant/actions/:actionId/complete-summary', async (
    request,
    reply,
  ) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { actionId } = request.params as { actionId?: unknown }
    const command = readAssistantVersionRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof actionId !== 'string' || !uuidPattern.test(actionId)
      || command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const state = options.pilotAssistantState
    if (state === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => state.completeSummary(
        sessionToken,
        actionId,
        command.expectedVersion,
      ),
      (result) => reply.header('cache-control', 'no-store').send({ result }),
    )
  })

  app.post('/v1/assistant/actions/:actionId/cancel', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { actionId } = request.params as { actionId?: unknown }
    const command = readAssistantVersionRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof actionId !== 'string' || !uuidPattern.test(actionId)
      || command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const state = options.pilotAssistantState
    if (state === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => state.cancelAction(
        sessionToken,
        actionId,
        command.expectedVersion,
      ),
      (result) => reply.header('cache-control', 'no-store').send({ result }),
    )
  })

  app.get('/v1/push-notifications/status', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    const pushNotifications = options.pilotPushNotifications
    if (pushNotifications === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => pushNotifications.readStatus(sessionToken),
      (status) => reply.header('cache-control', 'no-store').send({ status }),
    )
  })

  app.put('/v1/push-notifications/subscription', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const draft = readPushSubscriptionRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (draft === undefined) return reply.code(400).send({ error: 'invalid_request' })
    const pushNotifications = options.pilotPushNotifications
    if (pushNotifications === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => pushNotifications.upsertSubscription(sessionToken, draft),
      () => reply.header('cache-control', 'no-store').code(204).send(),
    )
  })

  app.delete('/v1/push-notifications/subscription', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    const pushNotifications = options.pilotPushNotifications
    if (pushNotifications === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => pushNotifications.deleteSubscription(sessionToken),
      () => reply.header('cache-control', 'no-store').code(204).send(),
    )
  })

  app.put('/v1/push-notifications/preferences/:kind', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { kind: rawKind } = request.params as { kind?: unknown }
    const kind = readPushNotificationKind(rawKind)
    const preference = readNotificationPreferenceRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (kind === undefined || preference === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const pushNotifications = options.pilotPushNotifications
    if (pushNotifications === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => pushNotifications.setPreference(sessionToken, kind, preference.enabled),
      () => reply.header('cache-control', 'no-store').code(204).send(),
    )
  })

  app.post('/v1/clients', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const draft = readCreateClientCardDraft(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (draft === undefined) return reply.code(400).send({ error: 'invalid_request' })
    const writer = options.pilotDomainWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.createClient(sessionToken, draft),
      (client) => reply.header('cache-control', 'no-store').code(201).send({ client }),
    )
  })

  app.put('/v1/clients/:clientId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId } = request.params as { clientId?: unknown }
    const command = readVersionedClientCardRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof clientId !== 'string' || !uuidPattern.test(clientId) || command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotDomainWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.updateClient(
        sessionToken,
        clientId,
        command.draft,
        command.expectedVersion,
      ),
      (version) => reply.header('cache-control', 'no-store').send({ client: { id: clientId, version } }),
    )
  })

  app.put('/v1/clients/:clientId/archive', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId } = request.params as { clientId?: unknown }
    const command = readArchiveRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof clientId !== 'string' || !uuidPattern.test(clientId) || command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotDomainWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.setClientArchived(
        sessionToken,
        clientId,
        command.archived,
        command.expectedVersion,
      ),
      (version) => reply.header('cache-control', 'no-store').send({ client: { id: clientId, version } }),
    )
  })

  app.put('/v1/clients/:clientId/preferences', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId } = request.params as { clientId?: unknown }
    const command = readClientPreferencesRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof clientId !== 'string' || !uuidPattern.test(clientId) || command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotDomainWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.updateClientPreferences(
        sessionToken,
        clientId,
        command.alias,
        command.note,
        command.expectedVersion,
      ),
      (membershipVersion) => reply
        .header('cache-control', 'no-store')
        .send({ client: { id: clientId, membershipVersion } }),
    )
  })

  app.post('/v1/custom-exercises', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const draft = readCustomExerciseDraft(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (draft === undefined) return reply.code(400).send({ error: 'invalid_request' })
    const writer = options.pilotDomainWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.createCustomExercise(sessionToken, draft),
      (exercise) => reply
        .header('cache-control', 'no-store')
        .code(201)
        .send({ exercise }),
    )
  })

  app.put('/v1/custom-exercises/:exerciseId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { exerciseId } = request.params as { exerciseId?: unknown }
    const command = readVersionedCustomExerciseRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof exerciseId !== 'string' || !uuidPattern.test(exerciseId) || command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotDomainWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.updateCustomExercise(
        sessionToken,
        exerciseId,
        command.draft,
        command.expectedVersion,
      ),
      (exercise) => reply.header('cache-control', 'no-store').send({ exercise }),
    )
  })

  app.put('/v1/custom-exercises/:exerciseId/archive', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { exerciseId } = request.params as { exerciseId?: unknown }
    const command = readArchiveRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof exerciseId !== 'string' || !uuidPattern.test(exerciseId) || command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotDomainWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.setCustomExerciseArchived(
        sessionToken,
        exerciseId,
        command.archived,
        command.expectedVersion,
      ),
      (exercise) => reply.header('cache-control', 'no-store').send({ exercise }),
    )
  })

  app.post('/v1/progress', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const command = readVersionedProgressRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (command === undefined || command.draft.id !== null) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.saveProgress(sessionToken, command.draft, command.expectedVersion),
      (progress) => reply.header('cache-control', 'no-store').code(201).send({ progress }))
  })

  app.put('/v1/progress/:progressId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { progressId } = request.params as { progressId?: unknown }
    const command = readVersionedProgressRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof progressId !== 'string' || !uuidPattern.test(progressId)
      || command === undefined || command.draft.id !== progressId
      || command.expectedVersion === null) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.saveProgress(sessionToken, command.draft, command.expectedVersion),
      (progress) => reply.header('cache-control', 'no-store').send({ progress }))
  })

  app.delete('/v1/progress/:progressId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { progressId } = request.params as { progressId?: unknown }
    const expectedVersion = readExpectedVersion(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof progressId !== 'string' || !uuidPattern.test(progressId)
      || expectedVersion === undefined) return reply.code(400).send({ error: 'invalid_request' })
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.deleteProgress(sessionToken, progressId, expectedVersion),
      (version) => reply.header('cache-control', 'no-store').send({ progress: { id: progressId, version } }))
  })

  app.post('/v1/progress-metrics', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const command = readVersionedMetricRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (command === undefined || command.draft.id !== null) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.saveMetric(sessionToken, command.draft, command.expectedVersion),
      (metric) => reply.header('cache-control', 'no-store').code(201).send({ metric }))
  })

  app.put('/v1/progress-metrics/:metricId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { metricId } = request.params as { metricId?: unknown }
    const command = readVersionedMetricRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof metricId !== 'string' || !uuidPattern.test(metricId)
      || command === undefined || command.draft.id !== metricId
      || command.expectedVersion === null) return reply.code(400).send({ error: 'invalid_request' })
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.saveMetric(sessionToken, command.draft, command.expectedVersion),
      (metric) => reply.header('cache-control', 'no-store').send({ metric }))
  })

  app.put('/v1/progress-metrics/:metricId/archive', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { metricId } = request.params as { metricId?: unknown }
    const command = readArchiveRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof metricId !== 'string' || !uuidPattern.test(metricId) || command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.setMetricArchived(sessionToken, metricId, command.archived, command.expectedVersion),
      (metric) => reply.header('cache-control', 'no-store').send({ metric }))
  })

  app.post('/v1/goals', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const command = readVersionedGoalRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (command === undefined || command.draft.id !== null) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.saveGoal(sessionToken, command.draft, command.expectedVersion),
      (goal) => reply.header('cache-control', 'no-store').code(201).send({ goal }))
  })

  app.put('/v1/goals/:goalId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { goalId } = request.params as { goalId?: unknown }
    const command = readVersionedGoalRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof goalId !== 'string' || !uuidPattern.test(goalId)
      || command === undefined || command.draft.id !== goalId
      || command.expectedVersion === null) return reply.code(400).send({ error: 'invalid_request' })
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.saveGoal(sessionToken, command.draft, command.expectedVersion),
      (goal) => reply.header('cache-control', 'no-store').send({ goal }))
  })

  app.put('/v1/goals/:goalId/archive', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { goalId } = request.params as { goalId?: unknown }
    const expectedVersion = readExpectedVersion(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof goalId !== 'string' || !uuidPattern.test(goalId) || expectedVersion === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.archiveGoal(sessionToken, goalId, expectedVersion),
      (version) => reply.header('cache-control', 'no-store').send({ goal: { id: goalId, version } }))
  })

  app.post('/v1/goal-stages', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const command = readVersionedGoalStageRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (command === undefined || command.draft.id !== null) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.saveStage(sessionToken, command.draft, command.expectedVersion),
      (stage) => reply.header('cache-control', 'no-store').code(201).send({ stage }))
  })

  app.put('/v1/goal-stages/:stageId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { stageId } = request.params as { stageId?: unknown }
    const command = readVersionedGoalStageRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof stageId !== 'string' || !uuidPattern.test(stageId)
      || command === undefined || command.draft.id !== stageId
      || command.expectedVersion === null) return reply.code(400).send({ error: 'invalid_request' })
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.saveStage(sessionToken, command.draft, command.expectedVersion),
      (stage) => reply.header('cache-control', 'no-store').send({ stage }))
  })

  app.delete('/v1/goal-stages/:stageId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { stageId } = request.params as { stageId?: unknown }
    const expectedVersion = readExpectedVersion(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof stageId !== 'string' || !uuidPattern.test(stageId) || expectedVersion === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const data = options.pilotProgressData
    if (data === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(reply,
      () => data.deleteStage(sessionToken, stageId, expectedVersion),
      () => reply.header('cache-control', 'no-store').send({ stage: { id: stageId, deleted: true } }))
  })

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

  app.post('/v1/workouts/completed', async (request, reply) => {
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
      () => writer.saveCompleted(
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

  app.put('/v1/workouts/:workoutId/completed', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof workoutId !== 'string' || !uuidPattern.test(workoutId)) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const command = readSavePlannedWorkoutRequest(request.body, workoutId)
    if (command === undefined || command.expectedVersion === null) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const expectedVersion = command.expectedVersion
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.saveCompleted(
        sessionToken,
        command.draft,
        expectedVersion,
      ),
      (saved) => reply
        .header('cache-control', 'no-store')
        .send({ workout: saved }),
    )
  })

  app.post('/v1/workouts/:workoutId/result', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof workoutId !== 'string' || !uuidPattern.test(workoutId)) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const command = readSavePlannedWorkoutRequest(request.body, workoutId)
    if (command === undefined || command.expectedVersion === null) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const expectedVersion = command.expectedVersion
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.recordPlannedResult(
        sessionToken,
        command.draft,
        expectedVersion,
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
      () => writer.deleteWorkout(sessionToken, workoutId, expectedVersion),
      (version) => reply
        .header('cache-control', 'no-store')
        .send({ workout: { id: workoutId, version } }),
    )
  })

  app.post('/v1/workouts/:workoutId/cancel', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    const expectedVersion = readExpectedVersion(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
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
      () => writer.cancelPlanned(sessionToken, workoutId, expectedVersion),
      (version) => reply
        .header('cache-control', 'no-store')
        .send({ workout: { id: workoutId, version } }),
    )
  })

  app.post('/v1/workouts/:workoutId/reschedule', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    const command = readRescheduleWorkoutRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof workoutId !== 'string'
      || !uuidPattern.test(workoutId)
      || command === undefined
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.reschedule(
        sessionToken,
        workoutId,
        command.workoutDate,
        command.startTime,
        command.expectedVersion,
      ),
      (version) => reply
        .header('cache-control', 'no-store')
        .send({ workout: { id: workoutId, version } }),
    )
  })

  app.put('/v1/workouts/:workoutId/comment', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    const command = readWorkoutCommentRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof workoutId !== 'string'
      || !uuidPattern.test(workoutId)
      || command === undefined
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.setClientComment(
        sessionToken,
        workoutId,
        command.comment,
        command.expectedVersion,
      ),
      (version) => reply
        .header('cache-control', 'no-store')
        .send({ workout: { id: workoutId, version } }),
    )
  })

  app.put('/v1/workouts/:workoutId/feedback', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    const command = readWorkoutFeedbackRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof workoutId !== 'string' || !uuidPattern.test(workoutId)
      || command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.submitFeedback(sessionToken, workoutId, command),
      (version) => reply.header('cache-control', 'no-store')
        .send({ workout: { id: workoutId, version } }),
    )
  })

  app.put('/v1/workouts/:workoutId/review', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    const command = readWorkoutTrainerResponseRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof workoutId !== 'string' || !uuidPattern.test(workoutId)
      || command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.setReview(sessionToken, workoutId, command),
      (version) => reply.header('cache-control', 'no-store')
        .send({ workout: { id: workoutId, version } }),
    )
  })

  app.put('/v1/workouts/:workoutId/question', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    const command = readWorkoutQuestionRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof workoutId !== 'string' || !uuidPattern.test(workoutId)
      || command === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.askQuestion(
        sessionToken, workoutId, command.question, command.expectedVersion,
      ),
      (version) => reply.header('cache-control', 'no-store')
        .send({ workout: { id: workoutId, version } }),
    )
  })

  app.put('/v1/workouts/:workoutId/question/answer', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    const command = readWorkoutTrainerResponseRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof workoutId !== 'string' || !uuidPattern.test(workoutId)
      || command === undefined || command.review.length === 0) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.answerQuestion(sessionToken, workoutId, command),
      (version) => reply.header('cache-control', 'no-store')
        .send({ workout: { id: workoutId, version } }),
    )
  })

  app.post('/v1/workouts/:workoutId/question/resolve', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    const expectedVersion = readExpectedVersion(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof workoutId !== 'string' || !uuidPattern.test(workoutId)
      || expectedVersion === undefined) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.resolveQuestion(sessionToken, workoutId, expectedVersion),
      (version) => reply.header('cache-control', 'no-store')
        .send({ workout: { id: workoutId, version } }),
    )
  })

  app.post('/v1/clients/:clientId/attention/snooze', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { clientId } = request.params as { clientId?: unknown }
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (typeof clientId !== 'string' || !uuidPattern.test(clientId)) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    return sendPilotCommand(
      reply,
      () => writer.snoozeAttention(sessionToken, clientId),
      (snoozedUntil) => reply.header('cache-control', 'no-store')
        .send({ client: { id: clientId, snoozedUntil } }),
    )
  })

  app.post('/v1/workouts/:workoutId/start', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    const command = readLiveOperationRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof workoutId !== 'string'
      || !uuidPattern.test(workoutId)
      || command === undefined
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.startLive(
        sessionToken,
        workoutId,
        command.expectedVersion,
        command.operationId,
      ),
      (result) => reply
        .header('cache-control', 'no-store')
        .send({ workout: { id: workoutId, ...result } }),
    )
  })

  app.post('/v1/workouts/:workoutId/exercises', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    const command = readLiveExerciseRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof workoutId !== 'string'
      || !uuidPattern.test(workoutId)
      || command === undefined
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.appendLiveExercise(
        sessionToken,
        workoutId,
        command.exercise,
        command.expectedVersion,
        command.operationId,
      ),
      (result) => reply
        .header('cache-control', 'no-store')
        .code(201)
        .send({
          exercise: {
            id: result.resourceId,
            replayed: result.replayed,
            version: result.version,
          },
        }),
    )
  })

  app.post('/v1/workout-exercises/:exerciseId/sets', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { exerciseId } = request.params as { exerciseId?: unknown }
    const command = readLiveOperationRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof exerciseId !== 'string'
      || !uuidPattern.test(exerciseId)
      || command === undefined
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.appendLiveSet(
        sessionToken,
        exerciseId,
        command.expectedVersion,
        command.operationId,
      ),
      (result) => reply
        .header('cache-control', 'no-store')
        .code(201)
        .send({
          set: {
            id: result.resourceId,
            replayed: result.replayed,
            version: result.version,
          },
        }),
    )
  })

  app.delete('/v1/workout-sets/:setId', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { setId } = request.params as { setId?: unknown }
    const command = readLiveOperationRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof setId !== 'string'
      || !uuidPattern.test(setId)
      || command === undefined
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.removeLiveSet(
        sessionToken,
        setId,
        command.expectedVersion,
        command.operationId,
      ),
      (result) => reply
        .header('cache-control', 'no-store')
        .send({
          set: {
            id: result.resourceId,
            replayed: result.replayed,
            version: result.version,
          },
        }),
    )
  })

  app.post(
    '/v1/workouts/:workoutId/blocks/:blockId/reorder',
    async (request, reply) => {
      const sessionToken = request.headers['x-fit-pilot-session']
      const { workoutId, blockId } = request.params as {
        blockId?: unknown
        workoutId?: unknown
      }
      const command = readLiveReorderRequest(request.body)
      if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
      if (
        typeof workoutId !== 'string'
        || !uuidPattern.test(workoutId)
        || typeof blockId !== 'string'
        || !uuidPattern.test(blockId)
        || command === undefined
      ) {
        return reply.code(400).send({ error: 'invalid_request' })
      }
      const writer = options.pilotWorkoutsWriter
      if (writer === undefined) {
        return reply.code(503).send({ error: 'service_unavailable' })
      }
      return sendPilotCommand(
        reply,
        () => writer.reorderLiveBlock(
          sessionToken,
          workoutId,
          blockId,
          command.direction,
          command.expectedVersion,
          command.operationId,
        ),
        (result) => reply
          .header('cache-control', 'no-store')
          .send({
            block: {
              id: result.resourceId,
              replayed: result.replayed,
              version: result.version,
            },
          }),
      )
    },
  )

  app.put(
    '/v1/workouts/:workoutId/exercises/:exerciseId',
    async (request, reply) => {
      const sessionToken = request.headers['x-fit-pilot-session']
      const { workoutId, exerciseId } = request.params as {
        exerciseId?: unknown
        workoutId?: unknown
      }
      const command = readLiveExerciseRequest(request.body)
      if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
      if (
        typeof workoutId !== 'string'
        || !uuidPattern.test(workoutId)
        || typeof exerciseId !== 'string'
        || !uuidPattern.test(exerciseId)
        || command === undefined
      ) {
        return reply.code(400).send({ error: 'invalid_request' })
      }
      const writer = options.pilotWorkoutsWriter
      if (writer === undefined) {
        return reply.code(503).send({ error: 'service_unavailable' })
      }
      return sendPilotCommand(
        reply,
        () => writer.replaceLiveExercise(
          sessionToken,
          workoutId,
          exerciseId,
          command.exercise,
          command.expectedVersion,
          command.operationId,
        ),
        (result) => reply
          .header('cache-control', 'no-store')
          .send({
            exercise: {
              id: result.resourceId,
              replayed: result.replayed,
              version: result.version,
            },
          }),
      )
    },
  )

  app.put('/v1/workout-exercises/:exerciseId/comment', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { exerciseId } = request.params as { exerciseId?: unknown }
    const command = readLiveCommentRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof exerciseId !== 'string'
      || !uuidPattern.test(exerciseId)
      || command === undefined
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.setLiveExerciseComment(
        sessionToken,
        exerciseId,
        command.comment,
        command.expectedVersion,
        command.operationId,
      ),
      (result) => reply
        .header('cache-control', 'no-store')
        .send({
          exercise: {
            id: result.resourceId,
            replayed: result.replayed,
            version: result.version,
          },
        }),
    )
  })

  app.put('/v1/workout-sets/:setId/draft', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { setId } = request.params as { setId?: unknown }
    const command = readLiveSetRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof setId !== 'string'
      || !uuidPattern.test(setId)
      || command === undefined
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.saveLiveSet(
        sessionToken,
        setId,
        command.draft,
        command.expectedVersion,
        command.operationId,
      ),
      (result) => reply
        .header('cache-control', 'no-store')
        .send({ set: { id: setId, ...result } }),
    )
  })

  app.post('/v1/workout-sets/:setId/confirm', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { setId } = request.params as { setId?: unknown }
    const command = readLiveOperationRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof setId !== 'string'
      || !uuidPattern.test(setId)
      || command === undefined
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.confirmLiveSet(
        sessionToken,
        setId,
        command.expectedVersion,
        command.operationId,
      ),
      (result) => reply
        .header('cache-control', 'no-store')
        .send({ set: { id: setId, ...result } }),
    )
  })

  app.post('/v1/workouts/:workoutId/finish', async (request, reply) => {
    const sessionToken = request.headers['x-fit-pilot-session']
    const { workoutId } = request.params as { workoutId?: unknown }
    const command = readLiveOperationRequest(request.body)
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (
      typeof workoutId !== 'string'
      || !uuidPattern.test(workoutId)
      || command === undefined
    ) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const writer = options.pilotWorkoutsWriter
    if (writer === undefined) {
      return reply.code(503).send({ error: 'service_unavailable' })
    }
    return sendPilotCommand(
      reply,
      () => writer.finishLive(
        sessionToken,
        workoutId,
        command.expectedVersion,
        command.operationId,
      ),
      (result) => reply
        .header('cache-control', 'no-store')
        .send({ workout: { id: workoutId, ...result } }),
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
