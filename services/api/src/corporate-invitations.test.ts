import {describe,expect,it,vi} from 'vitest'
import {buildApp} from './app.js'
import {readCorporateInvitationCreate,readCorporateInvitationToken,type CorporateInvitationsService} from './corporate-invitations.js'
const id='10000000-0000-4000-8000-000000000001',token='a'.repeat(43),headers={'x-fit-session':'b'.repeat(43)}
const service=(allowed=true)=>({access:vi.fn(()=>Promise.resolve(allowed)),list:vi.fn(()=>Promise.resolve({invitations:[]})),create:vi.fn(()=>Promise.resolve({id,token})),preview:vi.fn(()=>Promise.resolve({status:'active',offices:[]})),claim:vi.fn(()=>Promise.resolve({status:'claimed'})),decide:vi.fn(()=>Promise.resolve({saved:true}))} satisfies CorporateInvitationsService)
describe('corporate invitations HTTP boundaries',()=>{
 it('accepts bounded offices and opaque tokens, not links or raw metadata',()=>{
  expect(readCorporateInvitationCreate({id,officeIds:[id,id]})).toEqual({id,officeIds:[id]})
  for(const body of [null,{id,officeIds:[]},{id:'bad',officeIds:[id]},{id,officeIds:['bad']}])expect(readCorporateInvitationCreate(body)).toBeNull()
  expect(readCorporateInvitationToken({token})).toBe(token)
  expect(readCorporateInvitationToken({token:'https://example.test/invite'})).toBeNull()
 })
 it('requires a real app session and capability before parsing admin commands',async()=>{
  const store=service(false),app=buildApp({logger:false,corporateInvitations:store})
  expect((await app.inject({method:'POST',url:'/v1/admin/invitations',payload:{}})).statusCode).toBe(401)
  expect((await app.inject({method:'POST',url:'/v1/admin/invitations',headers,payload:{}})).statusCode).toBe(403)
  expect((await app.inject({method:'POST',url:'/v1/corporate-invitations/claim',headers:{'x-fit-pilot-session':token},payload:{token}})).statusCode).toBe(403)
  expect(store.create).not.toHaveBeenCalled();expect(store.claim).not.toHaveBeenCalled();await app.close()
 })
 it('previews without login, disables caching and forwards only explicit decisions',async()=>{
  const store=service(),app=buildApp({logger:false,corporateInvitations:store})
  const preview=await app.inject({method:'POST',url:'/v1/corporate-invitations/preview',payload:{token}})
  expect(preview.statusCode).toBe(200);expect(preview.headers['cache-control']).toBe('no-store')
  expect(store.preview).toHaveBeenCalledExactlyOnceWith(token)
  expect((await app.inject({method:'POST',url:`/v1/admin/invitations/${id}/approve`,headers,payload:{}})).statusCode).toBe(200)
  expect(store.decide).toHaveBeenCalledWith(expect.objectContaining({accessMode:'read_write'}),id,true)
  expect((await app.inject({method:'POST',url:'/v1/corporate-invitations/claim',headers,payload:{token}})).json()).toEqual({status:'claimed'})
  await app.close()
 })
 it('does not leak database or token details on failure',async()=>{
  const store=service();store.claim.mockRejectedValueOnce(Object.assign(new Error('corporate_invitation_pilot_only'),{code:'PT403'}))
  const app=buildApp({logger:false,corporateInvitations:store})
  const result=await app.inject({method:'POST',url:'/v1/corporate-invitations/claim',headers,payload:{token}})
  expect(result.statusCode).toBe(403);expect(result.json()).toEqual({error:'corporate_invitation_pilot_only'})
  store.claim.mockRejectedValueOnce(new Error('private DB and token details'))
  const failed=await app.inject({method:'POST',url:'/v1/corporate-invitations/claim',headers,payload:{token}})
  expect(failed.json()).toEqual({error:'service_unavailable'});await app.close()
 })
})
