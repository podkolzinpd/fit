import { randomUUID } from 'node:crypto'

import Fastify, { type FastifyInstance, type FastifyLoggerOptions } from 'fastify'

import type { BackgroundDispatchSummary } from './background-dispatcher.js'
import type { PushDispatchSummary } from './push-dispatcher.js'

interface PushDispatchRunner {
  run(): Promise<PushDispatchSummary | BackgroundDispatchSummary>
}

interface BuildPushDispatcherAppOptions {
  dispatcher: PushDispatchRunner
  logger?: boolean | FastifyLoggerOptions
  releaseId: string
}

const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isTimerEvent(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const messages = (value as Record<string, unknown>).messages
  if (!Array.isArray(messages) || messages.length !== 1) return false
  const message: unknown = messages[0]
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return false
  const record = message as Record<string, unknown>
  const metadata = record.event_metadata
  const details = record.details
  return typeof metadata === 'object'
    && metadata !== null
    && !Array.isArray(metadata)
    && (metadata as Record<string, unknown>).event_type
      === 'yandex.cloud.events.serverless.triggers.TimerMessage'
    && typeof details === 'object'
    && details !== null
    && !Array.isArray(details)
    && (details as Record<string, unknown>).payload === 'sync-push-notifications'
}

export function buildPushDispatcherApp(
  options: BuildPushDispatcherAppOptions,
): FastifyInstance {
  const logger = options.logger === false
    ? false
    : {
        ...(typeof options.logger === 'object' ? options.logger : {}),
        // Cloud Logging accepts string severity; Pino's default numeric level
        // is UNSPECIFIED and is filtered by the container's INFO minimum.
        formatters: { level: (label: string) => ({ level: label.toUpperCase() }) },
      }
  const app = Fastify({
    logger,
    // An idle serverless container can be suspended before its socket timer runs.
    // Never offer a socket from a previous invocation for reuse.
    maxRequestsPerSocket: 1,
    keepAliveTimeout: 5_000,
    genReqId: (request) => {
      const supplied = request.headers['x-request-id']
      return typeof supplied === 'string' && requestIdPattern.test(supplied)
        ? supplied
        : randomUUID()
    },
  })

  app.addHook('onRequest', (request, _reply, done) => {
    if (request.method === 'POST' && request.url === '/internal/push/dispatch') {
      request.log.info(
        { request_id: request.id, stage: 'received' },
        'Push dispatcher invocation',
      )
    }
    done()
  })

  app.get('/health', () => ({ releaseId: options.releaseId, status: 'ok' }))

  app.post('/internal/push/dispatch', async (request, reply) => {
    if (!isTimerEvent(request.body)) {
      request.log.warn(
        { request_id: request.id, stage: 'rejected' },
        'Push dispatcher invocation',
      )
      return reply.code(400).send({ status: 'invalid_timer_event' })
    }
    const startedAt = performance.now()
    try {
      const summary = await options.dispatcher.run()
      request.log.info(
        {
          request_id: request.id,
          stage: 'completed',
          durationMs: Math.round(performance.now() - startedAt),
        },
        'Push dispatcher invocation',
      )
      return { status: 'dispatched', ...summary }
    } catch (error) {
      request.log.error(
        {
          request_id: request.id,
          stage: 'failed',
          durationMs: Math.round(performance.now() - startedAt),
          errorType: error instanceof Error ? error.name : 'unknown',
        },
        'Background dispatch failed',
      )
      return reply.code(500).send({ status: 'dispatch_failed' })
    }
  })

  return app
}
