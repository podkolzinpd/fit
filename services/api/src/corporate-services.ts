import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from './db/types.js'
import { YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'
import { readYandexActorSession, withYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
const identifier = (value: unknown): value is string => typeof value === 'string' && uuid.test(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const kinds = ['consultation', 'tour', 'instruction', 'intro'] as const
export function corporateServiceDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4)) < 1) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value
}
export function corporateServiceMoment(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/)
  return m !== null && corporateServiceDate(m[1]) && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4]) < 60 && Number.isFinite(Date.parse(value))
}
export function readCorporateServiceDraft(body: unknown) {
  const v = record(body)
  if (!v || Object.keys(v).some(key => !['commandId','id','kind','officeId','occurredAt','version'].includes(key))
    || !identifier(v.commandId) || !identifier(v.id) || !identifier(v.officeId)
    || typeof v.kind !== 'string' || !kinds.includes(v.kind as typeof kinds[number])
    || !corporateServiceMoment(v.occurredAt) || !integer(v.version)) return null
  return {commandId:v.commandId,id:v.id,officeId:v.officeId,kind:v.kind,occurredAt:v.occurredAt,version:v.version}
}
export function readCorporateServiceRange(query: unknown) {
  const v = record(query)
  if (!v || !corporateServiceDate(v.from) || !corporateServiceDate(v.until)) return null
  const days = (Date.parse(`${v.until}T12:00:00Z`) - Date.parse(`${v.from}T12:00:00Z`)) / 86400000
  return days > 0 && days <= 93 ? {from:v.from,until:v.until} : null
}
export class CorporateServicesStore {
  constructor(private readonly pool: DatabasePool) {}
  access(session: YandexActorSession) {
    return withYandexActorSession(this.pool,session,async c => ({allowed:(await c.query<{allowed:boolean}>('select app_private.corporate_services_allowed() allowed'))[0]?.allowed === true}))
  }
  adminAccess(session: YandexActorSession) {
    return withYandexActorSession(this.pool,session,async c => (await c.query<{allowed:boolean}>('select app_private.is_corporate_admin() allowed'))[0]?.allowed === true)
  }
  list(session: YandexActorSession,range:NonNullable<ReturnType<typeof readCorporateServiceRange>>,cursorAt:string|null,cursorId:string|null) {
    return withYandexActorSession(this.pool,session,async c => (await c.query<{data:unknown}>(
      'select app_private.read_corporate_services($1,$2,$3,$4) data',[range.from,range.until,cursorAt,cursorId]))[0]!.data)
  }
  save(session: YandexActorSession,draft:NonNullable<ReturnType<typeof readCorporateServiceDraft>>) {
    return withYandexActorSession(this.pool,session,async c => (await c.query<{data:unknown}>(
      'select app_private.save_corporate_service($1,$2,$3,$4,$5,$6,false) data',
      [draft.commandId,draft.id,draft.kind,draft.officeId,draft.occurredAt,draft.version]))[0]!.data)
  }
  void(session: YandexActorSession,id:string,commandId:string,version:number) {
    return withYandexActorSession(this.pool,session,async c => (await c.query<{data:unknown}>(
      'select app_private.save_corporate_service($1,$2,null,null,null,$3,true) data',[commandId,id,version]))[0]!.data)
  }
  audit(session: YandexActorSession,id:string,before:number|null) {
    return withYandexActorSession(this.pool,session,async c => (await c.query<{data:unknown}>(
      'select app_private.read_corporate_service_audit($1,$2) data',[id,before]))[0]!.data)
  }
  record(session: YandexActorSession,id:string) {
    return withYandexActorSession(this.pool,session,async c => (await c.query<{data:unknown}>(
      'select app_private.read_corporate_service($1) data',[id]))[0]!.data)
  }
  statistics(session: YandexActorSession,range:NonNullable<ReturnType<typeof readCorporateServiceRange>>,trainerId:string|null,officeId:string|null) {
    return withYandexActorSession(this.pool,session,async c => (await c.query<{data:unknown}>(
      'select app_private.corporate_service_statistics($1,$2,$3,$4) data',[range.from,range.until,trainerId,officeId]))[0]!.data)
  }
}
export type CorporateServicesService = Pick<CorporateServicesStore,'access'|'adminAccess'|'list'|'record'|'save'|'void'|'audit'|'statistics'>
export function registerCorporateServiceRoutes(app:FastifyInstance,store:CorporateServicesService|undefined) {
  for (const kind of ['access','list','record','save','void','audit','statistics'] as const) {
    const url = kind === 'statistics' ? '/v1/admin/corporate-services' : kind === 'access' ? '/v1/corporate-services/access'
      : kind === 'record' ? '/v1/corporate-services/:id'
      : kind === 'audit' || kind === 'void' ? `/v1/corporate-services/:id/${kind}` : '/v1/corporate-services'
    app.route({method:kind === 'save' || kind === 'void' ? 'POST' : 'GET',url,bodyLimit:16*1024,handler:async(request,reply)=>{
      reply.header('cache-control','no-store')
      const session = readYandexActorSession(request.headers)
      if (!session) return reply.code(401).send({error:'unauthorized'})
      if (session.accessMode !== 'read_write') return reply.code(403).send({error:'corporate_forbidden'})
      if (!store) return reply.code(503).send({error:'service_unavailable'})
      try {
        if (kind === 'access') return reply.send(await store.access(session))
        const allowed = kind === 'statistics' ? await store.adminAccess(session) : (await store.access(session)).allowed
        if (!allowed) return reply.code(403).send({error:'corporate_forbidden'})
        if (kind === 'save') {
          const draft = readCorporateServiceDraft(request.body)
          return draft ? reply.send(await store.save(session,draft)) : reply.code(422).send({error:'corporate_service_invalid'})
        }
        const query = record(request.query) ?? {}
        if (kind === 'audit' || kind === 'void' || kind === 'record') {
          const id = record(request.params)?.id
          if (!identifier(id)) return reply.code(422).send({error:'corporate_service_invalid'})
          if (kind === 'record') return reply.send(await store.record(session,id))
          if (kind === 'audit') {
            const before = query.beforeVersion === undefined ? null : Number(query.beforeVersion)
            if (before !== null && (!integer(before) || before < 1)) return reply.code(422).send({error:'corporate_service_invalid'})
            return reply.send(await store.audit(session,id,before))
          }
          const body = record(request.body)
          if (!body || Object.keys(body).some(key=>!['commandId','version'].includes(key)) || !identifier(body.commandId) || !integer(body.version) || body.version < 1) return reply.code(422).send({error:'corporate_service_invalid'})
          return reply.send(await store.void(session,id,body.commandId,body.version))
        }
        const range = readCorporateServiceRange(query)
        if (!range) return reply.code(422).send({error:'corporate_service_invalid'})
        if (kind === 'statistics') {
          if (query.trainerId !== undefined && !identifier(query.trainerId) || query.officeId !== undefined && !identifier(query.officeId)) return reply.code(422).send({error:'corporate_service_invalid'})
          return reply.send(await store.statistics(session,range,query.trainerId as string ?? null,query.officeId as string ?? null))
        }
        const at = query.cursorAt, id = query.cursorId
        if ((at === undefined) !== (id === undefined) || at !== undefined && (!corporateServiceMoment(at) || !identifier(id))) return reply.code(422).send({error:'corporate_service_invalid'})
        return reply.send(await store.list(session,range,at as string ?? null,id as string ?? null))
      } catch (error) {
        if (error instanceof YandexAppSessionInvalidError) return reply.code(401).send({error:'unauthorized'})
        const failure = record(error)
        if (typeof failure?.code === 'string' && ['PT403','PT404','PT409','PT422'].includes(failure.code)
          && ['corporate_forbidden','corporate_not_found','corporate_conflict','corporate_service_invalid'].includes(String(failure.message))) return reply.code(Number(failure.code.slice(2))).send({error:failure.message})
        request.log.warn({event:'corporate_service_failed'},'Corporate service request failed')
        return reply.code(503).send({error:'service_unavailable'})
      }
    }})
  }
}
