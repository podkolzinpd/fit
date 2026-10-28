import { beforeEach, describe, expect, it, vi } from 'vitest'
import { corporateAdminRepository as repository } from './corporate-admin.repository'
const request=vi.hoisted(()=>vi.fn())
vi.mock('../queries/corporate-admin.queries',()=>({corporateAdminRequest:request}))
const id='10000000-0000-4000-8000-000000000001'
describe('corporate admin repository',()=>{
  beforeEach(()=>request.mockReset())
  it('fails closed for absent session or denied access',async()=>{
    for(const status of [401,403]) { request.mockResolvedValueOnce(new Response(null,{status})); expect(await repository.access()).toBe(false) }
  })
  it('does not treat a network failure as a denied role',async()=>{
    request.mockResolvedValueOnce(new Response(null,{status:503}))
    await expect(repository.access()).rejects.toThrow('проверить доступ')
  })
  it('validates bundle data before exposing it to the UI',async()=>{
    request.mockResolvedValueOnce(Response.json({offices:[],trainers:[]}))
    expect(await repository.bundle()).toEqual({offices:[],trainers:[]})
    request.mockResolvedValueOnce(Response.json({offices:[],trainers:[{id:'broken'}]}))
    await expect(repository.bundle()).rejects.toThrow()
  })
  it('preserves conflict and archive errors for a recoverable form',async()=>{
    request.mockResolvedValueOnce(Response.json({error:'corporate_conflict'},{status:409}))
    await expect(repository.saveTrainer({id,name:'Synthetic',isYandex:true,officeIds:[id],version:1})).rejects.toMatchObject({code:'corporate_conflict'})
    request.mockResolvedValueOnce(Response.json({error:'corporate_office_in_use'},{status:422}))
    await expect(repository.saveOffice({id,name:'Office',city:'City',address:'Address',archived:true,version:1})).rejects.toThrow('единственный активный офис')
  })
  it('does not send display names as authority or allow unacknowledged writes',async()=>{
    request.mockResolvedValueOnce(Response.json({saved:true}))
    await repository.saveTrainer({id,name:'Not an authorization field',isYandex:false,officeIds:[],version:2})
    expect(request).toHaveBeenCalledWith('trainers',{id,isYandex:false,officeIds:[],version:2})
    request.mockResolvedValueOnce(Response.json({}))
    await expect(repository.saveOffice({id,name:'Office',city:'City',address:'Address',archived:false,version:0})).rejects.toThrow()
  })
})
