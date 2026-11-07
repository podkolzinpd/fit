import {describe,expect,it,vi} from 'vitest'
import {buildApp} from './app.js'
import {readCorporateEmployeeCommand,type CorporatePersonalService} from './corporate-personal.js'
const id='10000000-0000-4000-8000-000000000001',headers={'x-fit-session':'b'.repeat(43)}
const command={commandId:id,marked:true,version:0}
const service=(allowed=true)=>({access:vi.fn(()=>Promise.resolve({allowed})),adminAccess:vi.fn(()=>Promise.resolve(allowed)),
  mark:vi.fn(()=>Promise.resolve({marked:false,version:0,fromDate:null})),save:vi.fn(()=>Promise.resolve({marked:true,version:1,fromDate:'2026-11-07'})),
  statistics:vi.fn(()=>Promise.resolve({count:0,trainers:[],records:[],nextCursor:null}))} satisfies CorporatePersonalService)
describe('corporate personal training boundaries',()=>{
  it('allows only a versioned boolean command, never identity, effective dates or office',()=>{
    expect(readCorporateEmployeeCommand(command)).toEqual(command)
    for(const input of [{...command,trainerId:id},{...command,fromDate:'2020-01-01'},{...command,officeId:id},
      {...command,marked:'true'},{...command,version:-1},{...command,version:1.2},{...command,commandId:'bad'}]) {
      expect(readCorporateEmployeeCommand(input)).toBeNull()
    }
  })
  it('requires a genuine write session and positive capability before parsing',async()=>{
    const store=service(false),app=buildApp({logger:false,corporatePersonal:store})
    for(const url of [`/v1/corporate-personal/clients/${id}`,'/v1/admin/corporate-personal']){
      expect((await app.inject({url})).statusCode).toBe(401)
      expect((await app.inject({url,headers})).statusCode).toBe(403)
    }
    expect((await app.inject({method:'PUT',url:'/v1/corporate-personal/clients/bad',headers,payload:{marked:true}})).statusCode).toBe(403)
    expect((await app.inject({url:'/v1/corporate-personal/access',headers:{'x-fit-pilot-session':'c'.repeat(43)}})).statusCode).toBe(403)
    expect(store.mark).not.toHaveBeenCalled();expect(store.save).not.toHaveBeenCalled();expect(store.statistics).not.toHaveBeenCalled()
    await app.close()
  })
  it('passes bounded private commands and disables caching',async()=>{
    const store=service(),app=buildApp({logger:false,corporatePersonal:store})
    const result=await app.inject({method:'PUT',url:`/v1/corporate-personal/clients/${id}`,headers,payload:command})
    expect(result.statusCode).toBe(200);expect(result.headers['cache-control']).toBe('no-store')
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({accessMode:'read_write'}),id,command)
    expect((await app.inject({url:`/v1/corporate-personal/clients/${id}`,headers})).statusCode).toBe(200)
    expect(store.mark).toHaveBeenCalledWith(expect.anything(),id)
    for(const query of ['from=2026-11-01&until=2026-11-02&officeId='+id,
      'from=2026-11-01&until=2026-11-02&cursorId='+id,'from=2026-11-01&until=2026-11-02&trainerId=bad',
      'from=2026-11-01&until=2026-11-02&cursorDate=2026-02-30&cursorId='+id,
      'from=2026-01-01&until=2026-12-31']) {
      expect((await app.inject({url:'/v1/admin/corporate-personal?'+query,headers})).statusCode).toBe(422)
    }
    expect((await app.inject({url:`/v1/admin/corporate-personal?from=2026-11-01&until=2026-11-02&trainerId=${id}&cursorDate=2026-11-01&cursorId=${id}`,headers})).statusCode).toBe(200)
    expect(store.statistics).toHaveBeenCalledWith(expect.anything(),{from:'2026-11-01',until:'2026-11-02'},id,'2026-11-01',id)
    await app.close()
  })
  it('maps known conflicts and hides internal failures',async()=>{
    const store=service(),app=buildApp({logger:false,corporatePersonal:store})
    store.save.mockRejectedValueOnce(Object.assign(new Error('corporate_conflict'),{code:'PT409'}))
    const conflict=await app.inject({method:'PUT',url:`/v1/corporate-personal/clients/${id}`,headers,payload:command})
    expect(conflict.statusCode).toBe(409);expect(conflict.json()).toEqual({error:'corporate_conflict'})
    store.mark.mockRejectedValueOnce(new Error('private account details'))
    const failed=await app.inject({url:`/v1/corporate-personal/clients/${id}`,headers})
    expect(failed.statusCode).toBe(503);expect(failed.json()).toEqual({error:'service_unavailable'})
    await app.close()
  })
})
