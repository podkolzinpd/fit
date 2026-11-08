import { beforeEach, describe, expect, it, vi } from 'vitest'
import { corporatePersonalRepository as repository, CorporatePersonalError } from './corporate-personal.repository'
const api=vi.hoisted(()=>({read:vi.fn(),write:vi.fn(),transport:vi.fn()}))
vi.mock('../yandex-app-session-transport',()=>({yandexAppSessionTransport:api.transport}))
vi.mock('../queries/yandex-main.queries',()=>({createYandexMainQueries:()=>api}))
const id='10000000-0000-4000-8000-000000000001'
beforeEach(()=>{vi.resetAllMocks();api.transport.mockReturnValue({apiBaseUrl:'https://example.test',sessionToken:'synthetic-session'})})
describe('corporate personal repository',()=>{
  it('distinguishes a negative gate from malformed or unavailable responses',async()=>{
    api.transport.mockReturnValueOnce(null);expect(await repository.access()).toBe(false);expect(api.read).not.toHaveBeenCalled()
    api.read.mockResolvedValueOnce(new Response(null,{status:403}));expect(await repository.access()).toBe(false)
    api.read.mockResolvedValueOnce(Response.json({allowed:'true'}));await expect(repository.access()).rejects.toMatchObject({status:503})
    api.read.mockResolvedValueOnce(new Response(null,{status:503}));await expect(repository.access()).rejects.toMatchObject({status:503})
  })
  it('uses PUT with a stable command and validates the returned date/version',async()=>{
    const command={marked:true,version:0,commandId:id}
    api.write.mockResolvedValueOnce(Response.json({marked:true,version:1,fromDate:'2026-11-07'}))
    expect(await repository.save(id,command)).toEqual({marked:true,version:1,fromDate:'2026-11-07'})
    expect(api.write).toHaveBeenCalledWith(`/v1/corporate-personal/clients/${id}`,'PUT',command)
    api.read.mockResolvedValueOnce(Response.json({marked:true,version:1,fromDate:'2026-13-01'}))
    await expect(repository.mark(id)).rejects.toMatchObject({status:503})
  })
  it('keeps server diagnostics private and bounds detail to period/trainer/cursor',async()=>{
    api.write.mockResolvedValueOnce(Response.json({error:'private SQL / identity details'},{status:409}))
    const error:unknown=await repository.save(id,{marked:false,version:1,commandId:id}).catch((value:unknown)=>value)
    expect(error).toBeInstanceOf(CorporatePersonalError)
    expect(error).toMatchObject({status:409})
    if(error instanceof Error)expect(error.message).not.toContain('private')
    api.read.mockResolvedValueOnce(Response.json({count:0,trainers:[],records:[],nextCursor:null}))
    await repository.statistics({from:'2026-11-01',until:'2026-11-08'},id,{date:'2026-11-07',id})
    expect(api.read).toHaveBeenCalledWith(`/v1/admin/corporate-personal?from=2026-11-01&until=2026-11-08&trainerId=${id}&cursorDate=2026-11-07&cursorId=${id}`)
  })
})
