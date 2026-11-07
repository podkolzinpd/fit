import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from './db/types.js'
import { YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'
import { corporateServiceDate, readCorporateServiceRange } from './corporate-services.js'
import { readYandexActorSession, withYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const record = (v: unknown): Record<string, unknown> | null => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null
const identifier = (v: unknown): v is string => typeof v === 'string' && uuid.test(v)
export function readCorporateEmployeeCommand(input: unknown) {
  const v = record(input)
  if (!v || Object.keys(v).some(k => !['commandId','marked','version'].includes(k))
    || !identifier(v.commandId) || typeof v.marked !== 'boolean'
    || !Number.isSafeInteger(v.version) || Number(v.version) < 0) return null
  return { commandId: v.commandId, marked: v.marked, version: Number(v.version) }
}
export class CorporatePersonalStore {
  constructor(private readonly pool: DatabasePool) {}
  access(session: YandexActorSession) {
    return withYandexActorSession(this.pool,session,async c => ({allowed:(await c.query<{allowed:boolean}>(
      'select app_private.corporate_personal_allowed() allowed'))[0]?.allowed === true}))
  }
  adminAccess(session: YandexActorSession) {
    return withYandexActorSession(this.pool,session,async c => (await c.query<{allowed:boolean}>(
      'select app_private.is_corporate_admin() allowed'))[0]?.allowed === true)
  }
  mark(session: YandexActorSession, clientId: string) {
    return withYandexActorSession(this.pool,session,async c => (await c.query<{data:unknown}>(
      'select app_private.read_corporate_employee_mark($1) data',[clientId]))[0]!.data)
  }
  save(session: YandexActorSession, clientId: string, command: NonNullable<ReturnType<typeof readCorporateEmployeeCommand>>) {
    return withYandexActorSession(this.pool,session,async c => (await c.query<{data:unknown}>(
      'select app_private.save_corporate_employee_mark($1,$2,$3,$4) data',
      [command.commandId,clientId,command.marked,command.version]))[0]!.data)
  }
  statistics(session: YandexActorSession, range: NonNullable<ReturnType<typeof readCorporateServiceRange>>,
    trainerId: string|null, cursorDate: string|null, cursorId: string|null) {
    return withYandexActorSession(this.pool,session,async c => (await c.query<{data:unknown}>(
      'select app_private.corporate_personal_statistics($1,$2,$3,$4,$5) data',
      [range.from,range.until,trainerId,cursorDate,cursorId]))[0]!.data)
  }
}
export type CorporatePersonalService = Pick<CorporatePersonalStore,'access'|'adminAccess'|'mark'|'save'|'statistics'>
export function registerCorporatePersonalRoutes(app: FastifyInstance, store: CorporatePersonalService|undefined) {
  for (const kind of ['access','mark','save','statistics'] as const) {
    app.route({method:kind === 'save' ? 'PUT' : 'GET',bodyLimit:4096,
      url:kind === 'statistics' ? '/v1/admin/corporate-personal'
        : kind === 'access' ? '/v1/corporate-personal/access' : '/v1/corporate-personal/clients/:id',
      handler:async(request,reply) => {
        reply.header('cache-control','no-store')
        const session = readYandexActorSession(request.headers)
        if (!session) return reply.code(401).send({error:'unauthorized'})
        if (session.accessMode !== 'read_write') return reply.code(403).send({error:'corporate_forbidden'})
        if (!store) return reply.code(503).send({error:'service_unavailable'})
        try {
          if (kind === 'access') return reply.send(await store.access(session))
          const allowed = kind === 'statistics' ? await store.adminAccess(session) : (await store.access(session)).allowed
          if (!allowed) return reply.code(403).send({error:'corporate_forbidden'})
          if (kind === 'mark' || kind === 'save') {
            const id = record(request.params)?.id
            if (!identifier(id)) return reply.code(422).send({error:'corporate_personal_invalid'})
            if (kind === 'mark') return reply.send(await store.mark(session,id))
            const command = readCorporateEmployeeCommand(request.body)
            return command ? reply.send(await store.save(session,id,command)) : reply.code(422).send({error:'corporate_personal_invalid'})
          }
          const query = record(request.query) ?? {}, range = readCorporateServiceRange(query)
          if (!range || Object.keys(query).some(k => !['from','until','trainerId','cursorDate','cursorId'].includes(k))
            || query.trainerId !== undefined && !identifier(query.trainerId)
            || (query.cursorDate === undefined) !== (query.cursorId === undefined)
            || query.cursorDate !== undefined && (!corporateServiceDate(query.cursorDate) || !identifier(query.cursorId))) {
            return reply.code(422).send({error:'corporate_personal_invalid'})
          }
          return reply.send(await store.statistics(session,range,query.trainerId as string ?? null,
            query.cursorDate as string ?? null,query.cursorId as string ?? null))
        } catch(error) {
          if (error instanceof YandexAppSessionInvalidError) return reply.code(401).send({error:'unauthorized'})
          const v = record(error)
          if (typeof v?.code === 'string' && ['PT403','PT404','PT409','PT422'].includes(v.code)
            && ['corporate_forbidden','corporate_not_found','corporate_conflict','corporate_personal_invalid'].includes(String(v.message))) {
            return reply.code(Number(v.code.slice(2))).send({error:v.message})
          }
          request.log.warn({event:'corporate_personal_failed'},'Corporate personal request failed')
          return reply.code(503).send({error:'service_unavailable'})
        }
      },
    })
  }
}
