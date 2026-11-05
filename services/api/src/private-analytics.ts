import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from './db/types.js'
import { readYandexActorSession, withYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'
import { YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'

export class PrivateAnalyticsStore {
  constructor(private readonly pool: DatabasePool) {}
  bundle(session: YandexActorSession) {
    return withYandexActorSession(this.pool, session, async client => {
      await client.query("set local statement_timeout = '20s'")
      const rows = await client.query<{ bundle: unknown }>('select app_private.private_analytics_bundle() bundle')
      if (!rows[0]?.bundle) throw new Error('analytics_bundle_missing')
      return rows[0].bundle
    }, 'read-only-snapshot')
  }
}

export type PrivateAnalyticsService = Pick<PrivateAnalyticsStore, 'bundle'>

export function registerPrivateAnalyticsRoutes(app: FastifyInstance, store: PrivateAnalyticsService | undefined) {
  app.get('/v1/private-analytics', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const session = readYandexActorSession(request.headers)
    if (!session) return reply.code(401).send({ error: 'unauthorized' })
    if (session.accessMode !== 'read_write') return reply.code(403).send({ error: 'analytics_forbidden' })
    if (!store) return reply.code(503).send({ error: 'service_unavailable' })
    try {
      return reply.send(await store.bundle(session))
    } catch (error) {
      if (error instanceof YandexAppSessionInvalidError) return reply.code(401).send({ error: 'unauthorized' })
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'PT403') {
        return reply.code(403).send({ error: 'analytics_forbidden' })
      }
      request.log.warn({ event: 'private_analytics_request_failed' }, 'Private analytics request failed')
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  })
}
