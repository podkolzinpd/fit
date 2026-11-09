import {beforeEach,describe,expect,it,vi} from 'vitest'
import {corporateDutiesRepository as repository,CorporateDutyError} from './corporate-duties.repository'
const api=vi.hoisted(()=>({read:vi.fn(),write:vi.fn(),transport:vi.fn()}))
vi.mock('../yandex-app-session-transport',()=>({yandexAppSessionTransport:api.transport}))
vi.mock('../queries/yandex-main.queries',()=>({createYandexMainQueries:()=>api}))
const id='10000000-0000-4000-8000-000000000001',range={from:'2026-11-01',until:'2026-11-09'}
const report={seconds:0,days:0,completed:0,open:0,review:0,records:[],nextCursor:null,trainers:[],offices:[],byTrainer:[],byOffice:[]}
const duty={id,trainerId:id,officeId:id,officeName:'Test',officeCity:'Synthetic',timeZone:'Europe/Moscow',startedAt:'2026-11-01T10:00:00Z',endedAt:null,version:1,status:'open',seconds:null}
beforeEach(()=>{vi.resetAllMocks();api.transport.mockReturnValue({apiBaseUrl:'https://example.test',sessionToken:'synthetic-session'})})
describe('corporate duty repository',()=>{
 it('uses the native v1 trainer history route and its unchanged cursor',async()=>{
  api.read.mockResolvedValue(Response.json(report));await repository.list(range,false,'','',{at:duty.startedAt,id})
  expect(api.read).toHaveBeenCalledWith(`/v1/corporate-duties?from=2026-11-01&until=2026-11-09&cursorAt=2026-11-01T10%3A00%3A00Z&cursorId=${id}`)
 })
 it('passes administrator filters independently of other statistic types',async()=>{
  api.read.mockResolvedValue(Response.json(report));await repository.list(range,true,id,id)
  expect(api.read).toHaveBeenCalledWith(`/v1/admin/corporate-duties?from=2026-11-01&until=2026-11-09&trainerId=${id}&officeId=${id}`)
 })
 it('validates closed and revoked access instead of silently treating unavailable data as denial',async()=>{
  api.transport.mockReturnValueOnce(null);await expect(repository.access()).rejects.toMatchObject({status:401});expect(api.read).not.toHaveBeenCalled()
  api.read.mockResolvedValueOnce(Response.json({allowed:false,hasHistory:true,active:duty,offices:[]}));expect((await repository.access()).active?.id).toBe(id)
  api.read.mockResolvedValueOnce(Response.json({allowed:'true'}));await expect(repository.access()).rejects.toMatchObject({status:503})
 })
 it('uses POST with stable intent for trainer and administrator without private response leakage',async()=>{
  const command={id,commandId:id,action:'start' as const,officeId:id,version:0}
  api.write.mockResolvedValueOnce(Response.json(duty));await repository.command(command)
  expect(api.write).toHaveBeenCalledWith('/v1/corporate-duties','POST',command)
  api.write.mockResolvedValueOnce(Response.json({error:'private SQL and account'},{status:409}))
  const error:unknown=await repository.command({...command,action:'void',reason:'Reason'},true).catch((e:unknown)=>e)
  expect(error).toBeInstanceOf(CorporateDutyError);if(error instanceof Error)expect(error.message).not.toMatch(/SQL|account/)
  expect(api.write).toHaveBeenLastCalledWith('/v1/admin/corporate-duties','POST',expect.objectContaining({action:'void',reason:'Reason'}))
 })
 it('does not invent a receipt after lost or malformed responses',async()=>{
  api.write.mockRejectedValueOnce(new Error('network'));await expect(repository.command({id,commandId:id,action:'stop',version:1})).rejects.toMatchObject({status:503})
  api.write.mockResolvedValueOnce(Response.json({...duty,version:0}));await expect(repository.command({id,commandId:id,action:'stop',version:1})).rejects.toMatchObject({status:503})
 })
 it('recovers current duty from bounded audit even when report dates no longer include it',async()=>{
  api.read.mockResolvedValue(Response.json({current:duty,records:[]}));expect((await repository.audit(id,42)).current.id).toBe(id)
  expect(api.read).toHaveBeenCalledWith(`/v1/admin/corporate-duties/${id}/audit?before=42`)
 })
 it('sends a separate versioned office timezone command without changing a duty',async()=>{
  api.write.mockResolvedValue(Response.json({timeZone:'Europe/Moscow',version:2}));await repository.zone(id,'Europe/Moscow',1)
  expect(api.write).toHaveBeenCalledWith('/v1/admin/corporate-duty-offices','POST',{officeId:id,timeZone:'Europe/Moscow',version:1})
 })
})
