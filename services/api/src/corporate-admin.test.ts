import { describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import { officeCommand, trainerCommand } from './corporate-admin.js'

const id = '10000000-0000-4000-8000-000000000001'
const office = { id, city:' Санкт-Петербург ',name:'Бенуа',address:'Адрес',archived:false,version:0 }
const session = { 'x-fit-session':'a'.repeat(43) }
const service = (allowed = true) => ({ access: vi.fn(() => Promise.resolve({ allowed })), bundle: vi.fn(() => Promise.resolve({offices:[],trainers:[]})),
  saveOffice: vi.fn(async () => {}), saveTrainer: vi.fn(async () => {}) })

describe('corporate admin API isolation', () => {
  it('validates versions, fields and office arrays', () => {
    expect(officeCommand(office)?.city).toBe('Санкт-Петербург')
    for(const patch of [{city:' '},{version:-1},{version:0.5},{archived:'false'},{id:'wrong'},{name:'x'.repeat(161)}]) expect(officeCommand({...office,...patch})).toBeNull()
    expect(trainerCommand({id,isYandex:true,officeIds:[],version:0})).toBeNull()
    expect(trainerCommand({id,isYandex:true,officeIds:[id,id],version:0})?.officeIds).toEqual([id])
    expect(trainerCommand({id,isYandex:true,officeIds:['bad'],version:0})).toBeNull()
  })
  it('requires an authenticated app session; pilot cannot read or write', async () => {
    const store=service(); const app=buildApp({logger:false,corporateAdmin:store})
    for(const [url,method] of [['bundle','GET'],['offices','PUT'],['trainers','PUT']] as const) {
      expect((await app.inject({url:`/v1/admin/${url}`,method})).statusCode).toBe(401)
      expect((await app.inject({url:`/v1/admin/${url}`,method,headers:{'x-fit-pilot-session':'a'.repeat(43)}})).statusCode).toBe(403)
    }
    expect(store.bundle).not.toHaveBeenCalled(); expect(store.saveOffice).not.toHaveBeenCalled(); await app.close()
  })
  it('does not allow a regular trainer or client to mutate metadata', async () => {
    const store=service(false); const app=buildApp({logger:false,corporateAdmin:store})
    expect((await app.inject({url:'/v1/admin/access',headers:session})).json()).toEqual({allowed:false})
    expect((await app.inject({url:'/v1/admin/offices',method:'PUT',headers:session,payload:office})).statusCode).toBe(403)
    expect(store.saveOffice).not.toHaveBeenCalled(); await app.close()
  })
  it('sends only validated commands to the authorized store and prevents cache', async () => {
    const store=service(); const app=buildApp({logger:false,corporateAdmin:store})
    const result=await app.inject({url:'/v1/admin/offices',method:'PUT',headers:session,payload:office})
    expect(result.statusCode).toBe(200); expect(result.headers['cache-control']).toBe('no-store')
    expect(store.saveOffice).toHaveBeenCalledWith(expect.objectContaining({accessMode:'read_write'}),{...office,city:'Санкт-Петербург'})
    expect((await app.inject({url:'/v1/admin/trainers',method:'PUT',headers:session,payload:{id,isYandex:true,officeIds:[],version:0}})).statusCode).toBe(422)
    await app.close()
  })
  it('returns safe conflict messages without database payloads', async () => {
    const store=service(); store.saveOffice.mockRejectedValueOnce(Object.assign(new Error('corporate_conflict'),{code:'PT409'}))
    const app=buildApp({logger:false,corporateAdmin:store})
    const result=await app.inject({url:'/v1/admin/offices',method:'PUT',headers:session,payload:office})
    expect(result.statusCode).toBe(409); expect(result.json()).toEqual({error:'corporate_conflict'}); await app.close()
  })
})
