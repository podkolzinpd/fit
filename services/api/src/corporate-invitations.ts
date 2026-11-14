import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from './db/types.js'
import { YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'
import { readYandexActorSession, withYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const tokenPattern = /^[a-zA-Z0-9_-]{43}$/
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const record = (v: unknown): Record<string, unknown> | null => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null
export function readCorporateInvitationCreate(body: unknown) {
  const v=record(body)
  if (!v || typeof v.id!=='string' || !uuid.test(v.id) || !Array.isArray(v.officeIds) || v.officeIds.length<1 || v.officeIds.length>100) return null
  const officeIds: string[]=[]
  for (const id of v.officeIds) { if (typeof id!=='string' || !uuid.test(id)) return null; if (!officeIds.includes(id)) officeIds.push(id) }
  if (v.recipientEmail !== undefined && (typeof v.recipientEmail !== 'string' || v.recipientEmail.trim().length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.recipientEmail.trim()) || Array.from(v.recipientEmail).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127))) return null
  return {id:v.id,officeIds,...(typeof v.recipientEmail==='string'?{recipientEmail:v.recipientEmail.trim().toLowerCase()}:{})}
}
export function readCorporateInvitationToken(body: unknown): string | null {
  const token=record(body)?.token
  return typeof token==='string' && tokenPattern.test(token) ? token : null
}
export class CorporateInvitationsStore {
  constructor(private readonly pool: DatabasePool) {}
  access(session: YandexActorSession) {
    return withYandexActorSession(this.pool,session,async c => (await c.query<{ allowed:boolean }>('select app_private.is_corporate_admin() allowed'))[0]?.allowed===true)
  }
  list(session: YandexActorSession) {
    return withYandexActorSession(this.pool,session,async c => ({invitations:(await c.query<{ invitations:unknown[] }>('select app_private.list_corporate_trainer_invitations() invitations'))[0]!.invitations}))
  }
  create(session: YandexActorSession,draft:NonNullable<ReturnType<typeof readCorporateInvitationCreate>>) {
    return withYandexActorSession(this.pool,session,async c => {
      const token=randomBytes(32).toString('base64url')
      await c.query('select app_private.create_corporate_invitation_for_recipient($1,$2,$3::uuid[],$4)',[draft.id,hash(token),draft.officeIds,draft.recipientEmail??null])
      return {id:draft.id,token}
    })
  }
  async preview(token:string) {
    const c=await this.pool.connect()
    try { return (await c.query<{ invitation: unknown }>('select app_private.preview_corporate_trainer_invitation($1) invitation',[hash(token)]))[0]?.invitation ?? null }
    finally {c.release()}
  }
  claim(session:YandexActorSession,token:string) {
    return withYandexActorSession(this.pool,session,async c => ({status:(await c.query<{ status:string }>('select app_private.claim_corporate_trainer_invitation($1) status',[hash(token)]))[0]!.status}))
  }
  decide(session:YandexActorSession,id:string,approve:boolean,enableTesting=false) {
    return withYandexActorSession(this.pool,session,async c => {
      if (approve && enableTesting) await c.query('select app_private.confirm_corporate_invitation_testing($1)',[id])
      else await c.query('select app_private.decide_corporate_trainer_invitation($1,$2)',[id,approve]); return {saved:true}
    })
  }
}
export type CorporateInvitationsService=Pick<CorporateInvitationsStore,'access'|'list'|'create'|'preview'|'claim'|'decide'>
export function registerCorporateInvitationRoutes(app:FastifyInstance,store:CorporateInvitationsService|undefined) {
  for (const kind of ['list','create','preview','claim','approve','revoke'] as const) {
    const admin=['list','create','approve','revoke'].includes(kind)
    const url=kind==='list'||kind==='create'?'/v1/admin/invitations':admin?`/v1/admin/invitations/:id/${kind}`:`/v1/corporate-invitations/${kind}`
    app.route({method:kind==='list'?'GET':'POST',url,bodyLimit:16*1024,handler:async(request,reply)=>{
      reply.header('cache-control','no-store')
      const session=readYandexActorSession(request.headers)
      if (kind!=='preview' && !session) return reply.code(401).send({error:'unauthorized'})
      if (kind!=='preview' && session?.accessMode!=='read_write') return reply.code(403).send({error:'corporate_forbidden'})
      if (!store) return reply.code(503).send({error:'service_unavailable'})
      try {
        if (admin && !(await store.access(session!))) return reply.code(403).send({error:'corporate_forbidden'})
        if (kind==='list') return reply.send(await store.list(session!))
        if (kind==='create') {
          const draft=readCorporateInvitationCreate(request.body)
          if (!draft) return reply.code(422).send({error:'corporate_invalid'})
          return reply.send(await store.create(session!,draft))
        }
        if (kind==='preview'||kind==='claim') {
          const token=readCorporateInvitationToken(request.body)
          if (!token) return reply.code(422).send({error:'corporate_invalid'})
          if (kind==='claim') return reply.send(await store.claim(session!,token))
          const invitation=await store.preview(token)
          return invitation===null?reply.code(404).send({error:'corporate_not_found'}):reply.send({invitation})
        }
        const id=record(request.params)?.id
        if (typeof id!=='string'||!uuid.test(id)) return reply.code(422).send({error:'corporate_invalid'})
        const enableTesting=record(request.body)?.enableTesting
        if (enableTesting!==undefined && (typeof enableTesting!=='boolean' || kind!=='approve')) return reply.code(422).send({error:'corporate_invalid'})
        return reply.send(await (enableTesting===true?store.decide(session!,id,true,true):store.decide(session!,id,kind==='approve')))
      } catch(error) {
        if (error instanceof YandexAppSessionInvalidError) return reply.code(401).send({error:'unauthorized'})
        const e=record(error)
        const known=['corporate_forbidden','corporate_not_found','corporate_invalid','corporate_conflict','corporate_trainer_required','corporate_invitation_pilot_only','corporate_invitation_unavailable','corporate_invitation_limit','corporate_email_invalid','corporate_recipient_pending','corporate_testing_managed']
        if (typeof e?.code==='string' && ['PT403','PT404','PT409','PT422'].includes(e.code) && typeof e.message==='string' && known.includes(e.message)) return reply.code(Number(e.code.slice(2))).send({error:e.message})
        request.log.warn({event:'corporate_invitation_failed'},'Corporate invitation failed')
        return reply.code(503).send({error:'service_unavailable'})
      }
    }})
  }
}
