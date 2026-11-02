import {describe,expect,it,vi} from 'vitest'
import {buildApp} from './app.js'
import {corporateServiceDate,corporateServiceMoment,readCorporateServiceDraft,readCorporateServiceRange,type CorporateServicesService} from './corporate-services.js'
const id='10000000-0000-4000-8000-000000000001',headers={'x-fit-session':'b'.repeat(43)}
const draft={id,commandId:id,officeId:id,kind:'consultation',occurredAt:'2026-11-01T09:20:00+03:00',version:0}
const service=(allowed=true)=>({access:vi.fn(()=>Promise.resolve({allowed})),adminAccess:vi.fn(()=>Promise.resolve(allowed)),list:vi.fn(()=>Promise.resolve({records:[],offices:[],nextCursor:null,timeZone:'Europe/Moscow'})),record:vi.fn(()=>Promise.resolve({id})),save:vi.fn(()=>Promise.resolve({saved:true,id,version:1})),void:vi.fn(()=>Promise.resolve({saved:true,id,version:2})),audit:vi.fn(()=>Promise.resolve({events:[],nextBeforeVersion:null})),statistics:vi.fn(()=>Promise.resolve({counts:{consultation:0,tour:0,instruction:0,intro:0}}))} satisfies CorporateServicesService)
describe('corporate service boundaries',()=>{
 it('accepts only bounded commands, real dates and timestamps with a zone',()=>{
  expect(readCorporateServiceDraft(draft)).toEqual(draft)
  for(const input of [{...draft,trainerId:id},{...draft,version:-1},{...draft,kind:'personal'},{...draft,occurredAt:'2026-02-30T10:00:00Z'},{...draft,occurredAt:'2026-11-01T10:00:00'},{...draft,occurredAt:'2026-11-01T24:00:00Z'}])expect(readCorporateServiceDraft(input)).toBeNull()
  expect(corporateServiceMoment('2026-11-01T09:20:00.123456+03:00')).toBe(true)
  expect(corporateServiceDate('2024-02-29')).toBe(true);expect(corporateServiceDate('2026-02-29')).toBe(false)
  expect(readCorporateServiceRange({from:'2026-11-01',until:'2026-11-02'})).toEqual({from:'2026-11-01',until:'2026-11-02'})
  for(const query of [{from:'2026-11-02',until:'2026-11-01'},{from:'2026-01-01',until:'2026-12-31'},{from:'bad',until:'2026-11-01'}])expect(readCorporateServiceRange(query)).toBeNull()
 })
 it('requires a genuine write session and checks capability before parsing or querying data',async()=>{
  const store=service(false),app=buildApp({logger:false,corporateServices:store})
  for(const url of ['/v1/corporate-services','/v1/admin/corporate-services',`/v1/corporate-services/${id}`,`/v1/corporate-services/${id}/audit`]){
   expect((await app.inject({url})).statusCode).toBe(401)
   expect((await app.inject({url,headers})).statusCode).toBe(403)
  }
  expect((await app.inject({method:'POST',url:'/v1/corporate-services',headers,payload:{trainerId:id}})).statusCode).toBe(403)
  expect((await app.inject({url:'/v1/corporate-services/access',headers:{'x-fit-pilot-session':'c'.repeat(43)}})).statusCode).toBe(403)
  expect(store.list).not.toHaveBeenCalled();expect(store.save).not.toHaveBeenCalled();expect(store.statistics).not.toHaveBeenCalled();await app.close()
 })
 it('passes only validated ranges, cursors and explicit own commands and disables caching',async()=>{
  const store=service(),app=buildApp({logger:false,corporateServices:store})
  const result=await app.inject({method:'POST',url:'/v1/corporate-services',headers,payload:draft})
  expect(result.statusCode).toBe(200);expect(result.headers['cache-control']).toBe('no-store');expect(store.save).toHaveBeenCalledWith(expect.objectContaining({accessMode:'read_write'}),draft)
  expect((await app.inject({url:'/v1/corporate-services?from=2026-11-01&until=2026-11-02&cursorId='+id,headers})).statusCode).toBe(422)
  expect((await app.inject({url:'/v1/corporate-services?from=2026-11-01&until=2026-11-02',headers})).statusCode).toBe(200)
  expect(store.list).toHaveBeenCalledWith(expect.anything(),{from:'2026-11-01',until:'2026-11-02'},null,null)
  expect((await app.inject({method:'POST',url:`/v1/corporate-services/${id}/void`,headers,payload:{commandId:id,version:1}})).statusCode).toBe(200)
  expect(store.void).toHaveBeenCalledWith(expect.anything(),id,id,1)
  expect((await app.inject({url:`/v1/corporate-services/${id}/audit?beforeVersion=-1`,headers})).statusCode).toBe(422)
  expect((await app.inject({url:`/v1/corporate-services/${id}/audit?beforeVersion=3`,headers})).statusCode).toBe(200)
  expect(store.audit).toHaveBeenCalledWith(expect.anything(),id,3)
  expect((await app.inject({url:`/v1/admin/corporate-services?from=2026-11-01&until=2026-11-02&trainerId=${id}&officeId=${id}`,headers})).statusCode).toBe(200)
  expect(store.statistics).toHaveBeenCalledWith(expect.anything(),{from:'2026-11-01',until:'2026-11-02'},id,id)
  await app.close()
 })
 it('maps safe errors and never returns internal query or identity details',async()=>{
  const store=service(),app=buildApp({logger:false,corporateServices:store})
  store.save.mockRejectedValueOnce(Object.assign(new Error('corporate_conflict'),{code:'PT409'}))
  const conflict=await app.inject({method:'POST',url:'/v1/corporate-services',headers,payload:draft});expect(conflict.statusCode).toBe(409);expect(conflict.json()).toEqual({error:'corporate_conflict'})
  store.save.mockRejectedValueOnce(new Error('private account/query/credential details'))
  const failed=await app.inject({method:'POST',url:'/v1/corporate-services',headers,payload:draft});expect(failed.statusCode).toBe(503);expect(failed.json()).toEqual({error:'service_unavailable'});await app.close()
 })
})
