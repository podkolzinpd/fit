import {describe,expect,it,vi} from 'vitest'
import {buildApp} from './app.js'
import {readCorporateDutyCommand,readCorporateDutyZone,type CorporateDutiesService} from './corporate-duties.js'
const id='10000000-0000-4000-8000-000000000001',headers={'x-fit-session':'b'.repeat(43)}
const start={commandId:id,id,action:'start',officeId:id,version:0}
const correct={...start,action:'correct',startedAt:'2026-11-01T10:00:00Z',endedAt:'2026-11-01T11:00:00Z',reason:'Исправление'}
const service=(allowed=true)=>({access:vi.fn(()=>Promise.resolve({allowed,active:null,offices:[],hasHistory:false})),adminAccess:vi.fn(()=>Promise.resolve(allowed)),command:vi.fn(()=>Promise.resolve({id})),zone:vi.fn(()=>Promise.resolve({})),list:vi.fn(()=>Promise.resolve({records:[]})),audit:vi.fn(()=>Promise.resolve({records:[]}))} satisfies CorporateDutiesService)
describe('corporate duties API boundaries',()=>{
 it('never accepts client time/identity at start/stop or trainer corrections',()=>{
  expect(readCorporateDutyCommand(start,false)).toMatchObject(start)
  for(const v of [{...start,startedAt:'2026-11-01T10:00:00Z'},{...start,trainerId:id},{...start,version:-1},{...start,id:'bad'},{...start,action:'stop'},correct])expect(readCorporateDutyCommand(v,false)).toBeNull()
  expect(readCorporateDutyCommand(correct,true)).toMatchObject(correct)
  for(const v of [{...correct,reason:''},{...correct,reason:'a'.repeat(501)},{...correct,endedAt:correct.startedAt},{...correct,startedAt:'2026-02-30T10:00:00Z'},{...correct,extra:true}])expect(readCorporateDutyCommand(v,true)).toBeNull()
  expect(readCorporateDutyZone({officeId:id,timeZone:'Europe/Moscow',version:0})).not.toBeNull()
  expect(readCorporateDutyZone({officeId:id,timeZone:'guess',version:0})).toBeNull()
 })
 it('denies anonymous/read-only/adminless requests and disables caches',async()=>{
  const store=service(false),app=buildApp({logger:false,corporateDuties:store})
  for(const url of ['/v1/corporate-duties/access','/v1/corporate-duties','/v1/admin/corporate-duties','/v1/admin/corporate-duties/'+id+'/audit']){
   const a=await app.inject({url});expect(a.statusCode).toBe(401);expect(a.headers['cache-control']).toBe('no-store')
   expect((await app.inject({url,headers:{'x-fit-pilot-session':'c'.repeat(43)}})).statusCode).toBe(403)
  }
  expect((await app.inject({method:'POST',url:'/v1/admin/corporate-duties',headers,payload:correct})).statusCode).toBe(403)
  expect(store.command).not.toHaveBeenCalled();expect(store.list).not.toHaveBeenCalled();await app.close()
 })
 it('delegates trainer stop even with revoked new-start access and validates bounded queries',async()=>{
  const store=service(),app=buildApp({logger:false,corporateDuties:store})
  const stop={commandId:id,id,action:'stop',version:1}
  expect((await app.inject({method:'POST',url:'/v1/corporate-duties',headers,payload:stop})).statusCode).toBe(200)
  expect(store.command).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({action:'stop',officeId:null}))
  for(const q of ['from=2026-01-01&until=2026-12-31','from=2026-11-01&until=2026-11-02&trainerId='+id,'from=2026-11-01&until=2026-11-02&cursorId='+id])expect((await app.inject({url:'/v1/corporate-duties?'+q,headers})).statusCode).toBe(422)
  expect((await app.inject({url:'/v1/admin/corporate-duties?from=2026-11-01&until=2026-11-02',headers})).statusCode).toBe(200)
  await app.close()
 })
 it('maps overlap/timezone failures without leaking private errors',async()=>{
  const store=service(),app=buildApp({logger:false,corporateDuties:store})
  for(const [code,message,status] of [['PT409','corporate_duty_overlap',409],['PT422','corporate_duty_timezone_required',422],['XX000','private details',503]] as const){
   store.command.mockRejectedValueOnce(Object.assign(new Error(message),{code}))
   const r=await app.inject({method:'POST',url:'/v1/corporate-duties',headers,payload:start});expect(r.statusCode).toBe(status);expect(r.json()).toEqual({error:status===503?'service_unavailable':message})
  }
  await app.close()
 })
})
