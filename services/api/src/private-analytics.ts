import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from './db/types.js'
import { readYandexActorSession, withYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'
import { YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'

export class PrivateAnalyticsStore {
  constructor(private readonly pool: DatabasePool) {}
  explore(session: YandexActorSession, filters: AnalyticsFilters) {
    return withYandexActorSession(this.pool, session, async client => {
      await client.query("set local statement_timeout = '12s'")
      const rows = await client.query<{ result: unknown }>('select app_private.private_analytics_explore($1::jsonb) result', [JSON.stringify(filters)])
      if (!rows[0]?.result) throw new Error('analytics_result_missing')
      return rows[0].result
    }, 'read-only-snapshot')
  }
  bundle(session: YandexActorSession) {
    return withYandexActorSession(this.pool, session, async client => {
      await client.query("set local statement_timeout = '20s'")
      const rows = await client.query<{ bundle: unknown }>('select app_private.private_analytics_bundle() bundle')
      if (!rows[0]?.bundle) throw new Error('analytics_bundle_missing')
      return rows[0].bundle
    }, 'read-only-snapshot')
  }
}

export type PrivateAnalyticsService = Pick<PrivateAnalyticsStore, 'bundle'> & Partial<Pick<PrivateAnalyticsStore, 'explore'>>

export function registerPrivateAnalyticsRoutes(app: FastifyInstance, store: PrivateAnalyticsService | undefined) {
  app.post('/v1/private-analytics/explore', {
    bodyLimit: 4096,
    childLoggerFactory(logger, bindings, options) {
      return logger.child(bindings, { ...options, serializers: { ...options.serializers, req: () => ({ method: 'POST', url: '/v1/private-analytics/explore' }) } })
    },
  }, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const session = readYandexActorSession(request.headers)
    if (!session) return reply.code(401).send({ error: 'unauthorized' })
    if (session.accessMode !== 'read_write') return reply.code(403).send({ error: 'analytics_forbidden' })
    const filters = parseAnalyticsFilters(request.body)
    if (!filters) return reply.code(422).send({ error: 'analytics_invalid' })
    if (!store?.explore) return reply.code(503).send({ error: 'service_unavailable' })
    try { return reply.send(await store.explore(session, filters)) }
    catch (error) {
      if (error instanceof YandexAppSessionInvalidError) return reply.code(401).send({ error: 'unauthorized' })
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'PT403') return reply.code(403).send({ error: 'analytics_forbidden' })
      request.log.warn({ event: 'private_analytics_explore_failed' }, 'Private analytics request failed')
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  })
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

export type AnalyticsFilters = {
  from: string; to: string; section: string; sort: string; direction: 'asc' | 'desc';
  page: number; pageSize: number; regularDays: number; group: string;
  role: string; person: string; trainer: string; registration: string; feature: string; exercise: string; search: string; cohort: string; status: string; entity: string; workout: string;
}
export function parseAnalyticsFilters(body: unknown): AnalyticsFilters | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const p = body as Record<string, unknown>
  const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
  if (!date(p.from) || !date(p.to) || p.from > p.to || Date.parse(p.to) - Date.parse(p.from) > 1095 * 86400000) return undefined
  const text = (key: string, fallback = '') => typeof p[key] === 'string' ? p[key] : p[key] === undefined ? fallback : null
  const section = text('section', 'people'), sort = text('sort', 'name'), direction = text('direction', 'asc'), group = text('group', 'day')
  const role = text('role'), person = text('person'), trainer = text('trainer'), registration = text('registration'), feature = text('feature'), exercise = text('exercise'), search = text('search'), cohort = text('cohort'), status = text('status'), entity = text('entity'), workout = text('workout')
  if ([section,sort,direction,group,role,person,trainer,registration,feature,exercise,search,cohort,status,entity,workout].some(v => v === null)) return undefined
  if (!['','new','active','accounts'].includes(cohort!) || !['','planned','in_progress','done','cancelled'].includes(status!) || !['people','activities','workouts','nutrition','payments','packages','exercises','exercise_detail','features','feedback','sets','referrals'].includes(section!)
    || !['asc','desc'].includes(direction!) || !['day','week','month'].includes(group!)
    || !['','trainer','client','offline'].includes(role!) || !['','self','trainer','connected'].includes(registration!)
    || !/^[a-z_]{1,40}$/.test(sort!) || person!.length > 50 || trainer!.length > 36 || feature!.length > 40 || exercise!.length > 180 || search!.length > 120 || entity!.length > 180 || workout!.length > 36) return undefined
  const integer = (key: string, fallback: number, max: number) => {
    const value = p[key] ?? fallback
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max ? value : undefined
  }
  const page = integer('page',1,1000000), pageSize = integer('pageSize',50,500), regularDays = integer('regularDays',2,7)
  if (page === undefined || pageSize === undefined || regularDays === undefined) return undefined
  return { from:p.from,to:p.to,section:section!,sort:sort!,direction:direction as 'asc'|'desc',group:group!,role:role!,person:person!,trainer:trainer!,registration:registration!,feature:feature!,exercise:exercise!,search:search!,cohort:cohort!,status:status!,entity:entity!,workout:workout!,page,pageSize,regularDays }
}
