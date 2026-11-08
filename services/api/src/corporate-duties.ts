import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from './db/types.js'
import { YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'
import { corporateServiceMoment, readCorporateServiceRange } from './corporate-services.js'
import { readYandexActorSession, withYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'

const record = (v:unknown):Record<string,unknown>|null => typeof v==='object' && v!==null && !Array.isArray(v)?v as Record<string,unknown>:null
const uuid = (v:unknown):v is string => typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
const version = (v:unknown):v is number => Number.isSafeInteger(v) && Number(v)>=0
export function readCorporateDutyCommand(body:unknown,admin:boolean) {
  const v=record(body)
  if(!v || !uuid(v.commandId) || !uuid(v.id) || !version(v.version))return null
  const action=v.action
  if(admin ? !['correct','void','restore','confirm'].includes(String(action)) : !['start','stop'].includes(String(action)))return null
  const fields=['commandId','id','action','version',...(action==='start'?['officeId']:[]),
    ...(admin?['reason']:[]),...(['correct','restore'].includes(String(action))?['officeId','startedAt','endedAt']:[])]
  if(Object.keys(v).some(k=>!fields.includes(k)))return null
  if((action==='start'||action==='correct'||action==='restore')&&!uuid(v.officeId))return null
  if(admin&&(typeof v.reason!=='string'||v.reason.trim().length<1||v.reason.trim().length>500))return null
  if((action==='correct'||action==='restore')&&(!corporateServiceMoment(v.startedAt)||!corporateServiceMoment(v.endedAt)
    ||Date.parse(v.startedAt)>=Date.parse(v.endedAt)))return null
  return {commandId:v.commandId,id:v.id,action:String(action),version:v.version,officeId:v.officeId as string??null,
    startedAt:v.startedAt as string??null,endedAt:v.endedAt as string??null,reason:typeof v.reason==='string'?v.reason.trim():null}
}
export function readCorporateDutyZone(body:unknown) {
  const v=record(body)
  if(!v||Object.keys(v).some(k=>!['officeId','timeZone','version'].includes(k))||!uuid(v.officeId)||!version(v.version)
    ||typeof v.timeZone!=='string'||v.timeZone.length>100)return null
  try{new Intl.DateTimeFormat('en',{timeZone:v.timeZone}).format()}catch{return null}
  return{officeId:v.officeId,timeZone:v.timeZone,version:v.version}
}
export class CorporateDutiesStore {
  constructor(private readonly pool:DatabasePool){}
  access(session:YandexActorSession){return withYandexActorSession(this.pool,session,async c=>(await c.query<{data:unknown}>('select app_private.corporate_duty_access() data'))[0]!.data)}
  adminAccess(session:YandexActorSession){return withYandexActorSession(this.pool,session,async c=>(await c.query<{allowed:boolean}>('select app_private.is_corporate_admin() allowed'))[0]?.allowed===true)}
  command(session:YandexActorSession,d:NonNullable<ReturnType<typeof readCorporateDutyCommand>>){
    return withYandexActorSession(this.pool,session,async c=>(await c.query<{data:unknown}>(
      'select app_private.command_corporate_duty($1,$2,$3,$4,$5,$6,$7,$8) data',
      [d.commandId,d.id,d.action,d.officeId,d.version,d.startedAt,d.endedAt,d.reason]))[0]!.data)
  }
  zone(session:YandexActorSession,d:NonNullable<ReturnType<typeof readCorporateDutyZone>>){
    return withYandexActorSession(this.pool,session,async c=>(await c.query<{data:unknown}>(
      'select app_private.save_corporate_duty_zone($1,$2,$3) data',[d.officeId,d.timeZone,d.version]))[0]!.data)
  }
  list(session:YandexActorSession,range:NonNullable<ReturnType<typeof readCorporateServiceRange>>,trainer:string|null,office:string|null,at:string|null,id:string|null,admin:boolean){
    return withYandexActorSession(this.pool,session,async c=>(await c.query<{data:unknown}>(
      'select app_private.read_corporate_duties($1,$2,$3,$4,$5,$6,$7) data',[range.from,range.until,trainer,office,at,id,admin]))[0]!.data)
  }
  audit(session:YandexActorSession,id:string,before:number|null){
    return withYandexActorSession(this.pool,session,async c=>(await c.query<{data:unknown}>(
      'select app_private.read_corporate_duty_audit($1,$2) data',[id,before]))[0]!.data)
  }
}
export type CorporateDutiesService=Pick<CorporateDutiesStore,'access'|'adminAccess'|'command'|'zone'|'list'|'audit'>
export function registerCorporateDutyRoutes(app:FastifyInstance,store:CorporateDutiesService|undefined){
  for(const kind of ['access','list','command','statistics','correct','zone','audit'] as const){
    const admin=['statistics','correct','zone','audit'].includes(kind)
    const url=kind==='access'?'/v1/corporate-duties/access':kind==='list'||kind==='command'?'/v1/corporate-duties'
      :kind==='statistics'||kind==='correct'?'/v1/admin/corporate-duties':kind==='zone'?'/v1/admin/corporate-duty-offices':'/v1/admin/corporate-duties/:id/audit'
    app.route({method:['command','correct','zone'].includes(kind)?'POST':'GET',url,bodyLimit:4096,handler:async(request,reply)=>{
      reply.header('cache-control','no-store')
      const session=readYandexActorSession(request.headers)
      if(!session)return reply.code(401).send({error:'unauthorized'})
      if(session.accessMode!=='read_write')return reply.code(403).send({error:'corporate_forbidden'})
      if(!store)return reply.code(503).send({error:'service_unavailable'})
      try{
        if(admin&&!await store.adminAccess(session))return reply.code(403).send({error:'corporate_forbidden'})
        if(kind==='access')return reply.send(await store.access(session))
        if(kind==='command'||kind==='correct'){
          const d=readCorporateDutyCommand(request.body,admin)
          return d?reply.send(await store.command(session,d)):reply.code(422).send({error:'corporate_duty_invalid'})
        }
        if(kind==='zone'){
          const d=readCorporateDutyZone(request.body)
          return d?reply.send(await store.zone(session,d)):reply.code(422).send({error:'corporate_duty_invalid'})
        }
        const q=record(request.query)??{}
        if(kind==='audit'){
          const id=record(request.params)?.id,before=q.before===undefined?null:Number(q.before)
          if(!uuid(id)||Object.keys(q).some(k=>k!=='before')||before!==null&&(!version(before)||before<1))return reply.code(422).send({error:'corporate_duty_invalid'})
          return reply.send(await store.audit(session,id,before))
        }
        const range=readCorporateServiceRange(q)
        if(!range||Object.keys(q).some(k=>!['from','until','trainerId','officeId','cursorAt','cursorId'].includes(k))
          ||q.trainerId!==undefined&&(!admin||!uuid(q.trainerId))||q.officeId!==undefined&&!uuid(q.officeId)
          ||(q.cursorAt===undefined)!==(q.cursorId===undefined)||q.cursorAt!==undefined&&(!corporateServiceMoment(q.cursorAt)||!uuid(q.cursorId)))return reply.code(422).send({error:'corporate_duty_invalid'})
        return reply.send(await store.list(session,range,q.trainerId as string??null,q.officeId as string??null,q.cursorAt as string??null,q.cursorId as string??null,admin))
      }catch(error){
        if(error instanceof YandexAppSessionInvalidError)return reply.code(401).send({error:'unauthorized'})
        const e=record(error)
        if(typeof e?.code==='string'&&['PT403','PT404','PT409','PT422'].includes(e.code)
          &&['corporate_forbidden','corporate_not_found','corporate_conflict','corporate_duty_invalid','corporate_duty_overlap','corporate_duty_timezone_required'].includes(String(e.message)))return reply.code(Number(e.code.slice(2))).send({error:e.message})
        request.log.warn({event:'corporate_duty_failed'},'Corporate duty request failed')
        return reply.code(503).send({error:'service_unavailable'})
      }
    }})
  }
}
