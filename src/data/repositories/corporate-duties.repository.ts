import type { CorporateDuty as SharedDuty, CorporateDutyAccess, CorporateDutyCommand, CorporateDutyOffice, CorporateDutyReport } from '../../shared/corporate-duties'
import { z } from 'zod'
import { yandexAppSessionTransport } from '../yandex-app-session-transport'
import { createYandexMainQueries } from '../queries/yandex-main.queries'
import type { ServiceRange, ServiceCursor } from './corporate-services.repository'

export class CorporateDutyError extends Error { constructor(public readonly status:number,message:string){super(message)} }
const instant=z.iso.datetime({offset:true})
const office=z.object({id:z.uuid(),name:z.string(),city:z.string(),timeZone:z.string().nullable()})
const duty=z.object({id:z.uuid(),trainerId:z.uuid(),officeId:z.uuid(),officeName:z.string(),officeCity:z.string(),timeZone:z.string(),
 startedAt:instant,endedAt:instant.nullable(),version:z.number().int().positive(),status:z.enum(['open','completed','review','void']),seconds:z.number().nonnegative().nullable()}) satisfies z.ZodType<SharedDuty>
export type CorporateDuty=z.infer<typeof duty>
const access=z.object({allowed:z.boolean(),hasHistory:z.boolean(),active:duty.nullable(),offices:z.array(office)}) satisfies z.ZodType<CorporateDutyAccess>
export type DutyAccess=z.infer<typeof access>
const zoneOffice=office.extend({archived:z.boolean(),zoneVersion:z.number().int().nonnegative()}) satisfies z.ZodType<CorporateDutyOffice>
export type DutyOffice=z.infer<typeof zoneOffice>
const counts={seconds:z.number().nonnegative(),days:z.number().int().nonnegative(),completed:z.number().int().nonnegative()}
const report=z.object({...counts,open:z.number().int().nonnegative(),review:z.number().int().nonnegative(),records:z.array(duty),
 nextCursor:z.object({at:instant,id:z.uuid()}).nullable(),trainers:z.array(z.object({id:z.uuid(),name:z.string()})),offices:z.array(zoneOffice),
 byTrainer:z.array(z.object({...counts,trainerId:z.uuid()})),byOffice:z.array(z.object({...counts,officeId:z.uuid()}))}) satisfies z.ZodType<CorporateDutyReport>
export type DutyReport=z.infer<typeof report>
export type DutyCommand=CorporateDutyCommand
const auditState=z.object({started_at:instant,ended_at:instant.nullable(),office_name:z.string(),office_city:z.string(),time_zone:z.string(),voided:z.boolean(),long_confirmed:z.boolean(),version:z.number().int().positive()})
const audit=z.object({current:duty,records:z.array(z.object({id:z.number().int().positive(),actor_id:z.uuid(),actorName:z.string(),occurred_at:instant,
 action:z.enum(['start','stop','correct','void','restore','confirm']),reason:z.string().nullable(),before_data:auditState.nullable(),after_data:auditState}))})
export type DutyAudit=z.infer<typeof audit>
async function request<T>(schema:z.ZodType<T>,path:string,body?:object):Promise<T>{
 const session=yandexAppSessionTransport()
 if(!session)throw new CorporateDutyError(401,'Войдите в ФИТ снова.')
 const queries=createYandexMainQueries(session.apiBaseUrl,session.sessionToken)
 let response:Response
 try{response=await (body===undefined?queries.read(path):queries.write(path,'POST',body))}
 catch{throw new CorporateDutyError(503,'Ответ не получен. Проверьте сохранённое состояние перед следующим действием.')}
 if(!response.ok){
  const messages:Record<number,string>={401:'Войдите в ФИТ снова.',403:'Доступ закрыт. Своё открытое дежурство можно завершить после обновления состояния.',404:'Запись не найдена.',409:'Запись уже изменилась или пересекается с другим дежурством. Загрузите сохранённое состояние.',422:'Проверьте офис, его часовой пояс, время и причину изменения.'}
  throw new CorporateDutyError(response.status,messages[response.status]??'Не удалось выполнить действие. Проверьте сохранённое состояние.')
 }
 let bodyValue:unknown
 try{bodyValue=await response.json()}catch{throw new CorporateDutyError(503,'Не удалось прочитать ответ сервера. Проверьте сохранённое состояние.')}
 const parsed=schema.safeParse(bodyValue)
 if(!parsed.success)throw new CorporateDutyError(503,'Не удалось прочитать ответ сервера. Проверьте сохранённое состояние.')
 return parsed.data
}
export const corporateDutiesRepository={
 access:()=>request(access,'/v1/corporate-duties/access'),
 command:(value:DutyCommand,admin=false)=>request(duty,admin?'/v1/admin/corporate-duties':'/v1/corporate-duties',value),
 list:(range:ServiceRange,admin=false,trainerId='',officeId='',cursor?:ServiceCursor)=>{
  const q=new URLSearchParams({...range});if(trainerId)q.set('trainerId',trainerId);if(officeId)q.set('officeId',officeId)
  if(cursor){q.set('cursorAt',cursor.at);q.set('cursorId',cursor.id)}
  return request(report,`${admin?'/v1/admin':'/v1'}/corporate-duties?${q}`)
 },
 zone:(officeId:string,timeZone:string,version:number)=>request(z.object({timeZone:z.string(),version:z.number().int().positive()}),'/v1/admin/corporate-duty-offices',{officeId,timeZone,version}),
 audit:(id:string,before?:number)=>request(audit,`/v1/admin/corporate-duties/${encodeURIComponent(id)}/audit${before===undefined?'':`?before=${before}`}`),
}
