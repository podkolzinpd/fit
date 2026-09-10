import Fastify, { type FastifyInstance } from 'fastify'

import type { BackgroundDispatchSummary } from './background-dispatcher.js'
import type { PushDispatchSummary } from './push-dispatcher.js'

interface PushDispatchRunner {
  run(): Promise<PushDispatchSummary | BackgroundDispatchSummary>
}

interface BuildPushDispatcherAppOptions {
  dispatcher: PushDispatchRunner
  logger?: boolean
  releaseId: string
}

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
  const app = Fastify({ logger: options.logger ?? true })

  app.get('/health', () => ({ releaseId: options.releaseId, status: 'ok' }))

  app.post('/internal/push/dispatch', async (request, reply) => {
    if (!isTimerEvent(request.body)) {
      return reply.code(400).send({ status: 'invalid_timer_event' })
    }
    try {
      const summary = await options.dispatcher.run()
      return { status: 'dispatched', ...summary }
    } catch (error) {
      request.log.error(
        { errorType: error instanceof Error ? error.name : 'unknown' },
        'Background dispatch failed',
      )
      return reply.code(500).send({ status: 'dispatch_failed' })
    }
  })

  return app
}
