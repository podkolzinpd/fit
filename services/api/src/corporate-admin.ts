import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from './db/types.js'
import { readYandexActorSession, withYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'
import { YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const record = (v: unknown): Record<string, unknown> | null => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max
const version = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0

export function officeCommand(body: unknown) {
  const v = record(body)
  if (!v || typeof v.id !== 'string' || !uuid.test(v.id) || !text(v.city, 100)
    || !text(v.name, 160) || !text(v.address, 300) || typeof v.archived !== 'boolean' || !version(v.version)) return null
  return { id: v.id, city: v.city.trim(), name: v.name.trim(), address: v.address.trim(), archived: v.archived, version: v.version }
}
export function trainerCommand(body: unknown) {
  const v = record(body)
  if (!v || typeof v.id !== 'string' || !uuid.test(v.id) || typeof v.isYandex !== 'boolean' || !version(v.version)
    || !Array.isArray(v.officeIds) || v.officeIds.length > 100) return null
  const officeIds: string[] = []
  for (const id of v.officeIds) {
    if (typeof id !== 'string' || !uuid.test(id)) return null
    if (!officeIds.includes(id)) officeIds.push(id)
  }
  if (v.isYandex && officeIds.length === 0) return null
  return { id: v.id, isYandex: v.isYandex, officeIds, version: v.version }
}

export class CorporateAdminStore {
  constructor(private readonly pool: DatabasePool) {}
  access(session: YandexActorSession) {
    return withYandexActorSession(this.pool, session, async client => {
      const rows = await client.query<{ allowed: boolean }>('select app_private.is_corporate_admin() allowed')
      return { allowed: rows[0]?.allowed === true }
    })
  }
  bundle(session: YandexActorSession) {
    return withYandexActorSession(this.pool, session, async client => {
      const rows = await client.query<{ bundle: unknown }>('select app_private.corporate_admin_bundle() bundle')
      if (!rows[0]?.bundle) throw new Error('corporate_bundle_missing')
      return rows[0].bundle
    })
  }
  saveOffice(session: YandexActorSession, draft: NonNullable<ReturnType<typeof officeCommand>>) {
    return withYandexActorSession(this.pool, session, async client => {
      await client.query('select app_private.save_corporate_office($1,$2,$3,$4,$5,$6)',
        [draft.id, draft.city, draft.name, draft.address, draft.archived, draft.version])
    })
  }
  saveTrainer(session: YandexActorSession, draft: NonNullable<ReturnType<typeof trainerCommand>>) {
    return withYandexActorSession(this.pool, session, async client => {
      await client.query('select app_private.save_corporate_trainer($1,$2,$3::uuid[],$4)',
        [draft.id, draft.isYandex, draft.officeIds, draft.version])
    })
  }
}

export type CorporateAdminService = Pick<CorporateAdminStore, 'access' | 'bundle' | 'saveOffice' | 'saveTrainer'>

export function registerCorporateAdminRoutes(app: FastifyInstance, store: CorporateAdminService | undefined) {
  for (const path of ['access', 'bundle', 'offices', 'trainers'] as const) {
    app.route({ method: path === 'access' || path === 'bundle' ? 'GET' : 'PUT',
      url: `/v1/admin/${path}`, bodyLimit: 32 * 1024,
      handler: async (request, reply) => {
        reply.header('cache-control', 'no-store')
        const session = readYandexActorSession(request.headers)
        if (!session) return reply.code(401).send({ error: 'unauthorized' })
        if (session.accessMode !== 'read_write') return reply.code(403).send({ error: 'corporate_forbidden' })
        if (!store) return reply.code(503).send({ error: 'service_unavailable' })
        try {
          if (path === 'access') return reply.send(await store.access(session))
          if (path === 'bundle') return reply.send(await store.bundle(session))
          // Check capability before validation; no metadata oracle for ordinary users.
          if (!(await store.access(session)).allowed) return reply.code(403).send({ error: 'corporate_forbidden' })
          if (path === 'offices') {
            const draft = officeCommand(request.body)
            if (!draft) return reply.code(422).send({ error: 'corporate_invalid' })
            await store.saveOffice(session, draft)
          } else {
            const draft = trainerCommand(request.body)
            if (!draft) return reply.code(422).send({ error: 'corporate_invalid' })
            await store.saveTrainer(session, draft)
          }
          return reply.send({ saved: true })
        } catch (error) {
          if (error instanceof YandexAppSessionInvalidError) return reply.code(401).send({ error: 'unauthorized' })
          const failure = record(error)
          const code = failure?.code
          const message = failure?.message
          if (typeof code === 'string' && ['PT403','PT404','PT409','PT422'].includes(code)) {
            const known = typeof message === 'string' && ['corporate_forbidden','corporate_not_found','corporate_conflict','corporate_invalid','corporate_office_in_use','corporate_office_duplicate'].includes(message)
            return reply.code(Number(code.slice(2))).send({ error: known ? message : 'corporate_invalid' })
          }
          request.log.warn({ event: 'corporate_admin_request_failed' }, 'Corporate admin request failed')
          return reply.code(503).send({ error: 'service_unavailable' })
        }
      },
    })
  }
}
