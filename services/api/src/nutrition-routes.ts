import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify'
import { DatabaseNutritionDiary, isNutritionDate, readNutritionDraft, NutritionSearchRateLimitError } from './nutrition-diary.js'
import { NutritionCatalogUnavailableError } from './nutrition-catalog.js'
import { PilotDomainCommandError } from './domain-commands.js'
import { YandexAppSessionDeniedError, YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'
import { readYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'

export type NutritionDiary = Pick<DatabaseNutritionDiary, 'day' | 'recent' | 'save' | 'search' | 'setDeleted' | 'consents' | 'setConsent'>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function privateRequestLog(method: string, url: string): Pick<RouteShorthandOptions, 'childLoggerFactory'> {
  return {
    childLoggerFactory(logger, bindings, options) {
      return logger.child(bindings, { ...options, serializers: { ...options.serializers,
        req: () => ({ method, url }),
      } })
    },
  }
}

export function registerNutritionRoutes(app: FastifyInstance, diary: NutritionDiary | undefined) {
  async function run(request: FastifyRequest, reply: FastifyReply,
    work: (service: NutritionDiary, session: YandexActorSession) => Promise<unknown>) {
    reply.header('cache-control', 'no-store')
    const session = readYandexActorSession(request.headers)
    if (session === undefined) return reply.code(401).send({ error: 'unauthorized' })
    if (session.accessMode !== 'read_write') return reply.code(403).send({ error: 'action_not_allowed' })
    if (diary === undefined) return reply.code(503).send({ error: 'service_unavailable' })
    try {
      return reply.send(await work(diary, session))
    } catch (error) {
      if (error instanceof YandexAppSessionInvalidError) return reply.code(401).send({ error: 'unauthorized' })
      if (error instanceof YandexAppSessionDeniedError) return reply.code(403).send({ error: 'action_not_allowed' })
      if (error instanceof PilotDomainCommandError) {
        const codes = { forbidden: 403, invalid: 422, not_found: 404, conflict: 409 }
        return reply.code(codes[error.failure]).send({ error: `nutrition_${error.failure}` })
      }
      if (error instanceof NutritionSearchRateLimitError) return reply.header('retry-after', '1').code(429).send({ error: 'nutrition_search_rate_limited' })
      if (error instanceof NutritionCatalogUnavailableError) return reply.code(503).send({ error: 'nutrition_search_unavailable' })
      // PII, SQL, upstream response bodies and session tokens must not be logged.
      request.log.error({ code: 'nutrition_request_failed' }, 'Nutrition request failed')
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  }
  app.get('/v1/me/nutrition', privateRequestLog('GET', '/v1/me/nutrition'), (request, reply) => run(request, reply, async (service, session) => {
    const { day } = object(request.query)
    if (!isNutritionDate(day)) throw new PilotDomainCommandError('invalid')
    return service.day(session, day)
  }))
  app.get('/v1/clients/:clientId/nutrition', privateRequestLog('GET', '/v1/clients/:clientId/nutrition'), (request, reply) => run(request, reply, async (service, session) => {
    const { day } = object(request.query), { clientId } = object(request.params)
    if (!isNutritionDate(day) || typeof clientId !== 'string' || !uuid.test(clientId)) throw new PilotDomainCommandError('invalid')
    return service.day(session, day, clientId)
  }))
  app.get('/v1/me/nutrition/recent', privateRequestLog('GET', '/v1/me/nutrition/recent'), (request, reply) => run(request, reply, (service, session) => service.recent(session)))
  app.get('/v1/me/nutrition/consents', privateRequestLog('GET', '/v1/me/nutrition/consents'), (request, reply) => run(request, reply, (service, session) => service.consents(session)))
  app.get('/v1/nutrition/foods', privateRequestLog('GET', '/v1/nutrition/foods'), (request, reply) => run(request, reply, async (service, session) => {
    const { q, page } = object(request.query), number = page === undefined ? 1 : Number(page)
    if (typeof q !== 'string' || q.trim().length < 2 || q.length > 120
      || !Number.isSafeInteger(number) || number < 1 || number > 100) throw new PilotDomainCommandError('invalid')
    return service.search(session, q, number)
  }))
  app.put('/v1/me/nutrition/entries', privateRequestLog('PUT', '/v1/me/nutrition/entries'), (request, reply) => run(request, reply, async (service, session) => {
    const draft = readNutritionDraft(request.body)
    if (draft === undefined) throw new PilotDomainCommandError('invalid')
    return service.save(session, draft)
  }))
  app.put('/v1/me/nutrition/entries/:entryId/visibility', privateRequestLog('PUT', '/v1/me/nutrition/entries/:entryId/visibility'), (request, reply) => run(request, reply, async (service, session) => {
    const { entryId } = object(request.params), { expectedVersion, deleted } = object(request.body)
    if (typeof entryId !== 'string' || !uuid.test(entryId) || typeof expectedVersion !== 'number'
      || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || typeof deleted !== 'boolean') {
      throw new PilotDomainCommandError('invalid')
    }
    return service.setDeleted(session, entryId, expectedVersion, deleted)
  }))
  app.put('/v1/me/nutrition/consents', privateRequestLog('PUT', '/v1/me/nutrition/consents'), (request, reply) => run(request, reply, async (service, session) => {
    const { clientId, trainerId, connectionStartedAt, granted } = object(request.body)
    if (typeof clientId !== 'string' || !uuid.test(clientId) || typeof trainerId !== 'string' || !uuid.test(trainerId)
      || typeof connectionStartedAt !== 'string' || connectionStartedAt.length > 40
      || !/^\d{4}-\d{2}-\d{2}T/.test(connectionStartedAt) || !Number.isFinite(Date.parse(connectionStartedAt))
      || typeof granted !== 'boolean') throw new PilotDomainCommandError('invalid')
    return service.setConsent(session, clientId, trainerId, connectionStartedAt, granted)
  }))
}
