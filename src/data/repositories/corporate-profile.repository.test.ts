import {beforeEach,describe,expect,it,vi} from 'vitest'
import {emptyTrainerProfileDraft} from '../../shared/trainer-profile'
const mocks=vi.hoisted(()=>({request:vi.fn<(target:string,suffix?:string,body?:object)=>Promise<Response>>()}))
vi.mock('../queries/corporate-profile.queries',()=>({corporateProfileRequest:mocks.request}))
import {corporateProfilesRepository as repo} from './corporate-profile.repository'
const target='11111111-1111-4111-8111-111111111111'
const context={version:4,managementVersion:2,commandId:'22222222-2222-4222-8222-222222222222'}
const profile={publicId:target,draft:emptyTrainerProfileDraft('Тренер'),published:null,listedInCatalog:false,publishedAt:null,updatedAt:'2026-11-09T12:00:00Z',version:5,isBrandTrainer:false}
describe('corporate profile transport contract',()=>{
 beforeEach(()=>{mocks.request.mockReset().mockImplementation(()=>Promise.resolve(Response.json(profile)))})
 it('scopes every mutation explicitly and sends command id and both versions, without impersonation',async()=>{
  const editor=repo.editor(target)
  await editor.saveDraft(profile.draft,context);await editor.reorderPhotos([],context);await editor.deletePhoto(context.commandId,context)
  await editor.publish(context);await editor.unpublish(context);await editor.setCatalogListing(false,context)
  expect(mocks.request.mock.calls.map(call=>(call[2] as Record<string,unknown>).action)).toEqual(['save','reorder','delete','publish','unpublish','catalog'])
  for(const call of mocks.request.mock.calls){expect(call[0]).toBe(target);expect(call[1]).toBe('/command');expect(call[2]).toMatchObject(context);expect(call[2]).not.toHaveProperty('session')}
 })
 it('requires a loaded mutation context, rather than guessing a version',async()=>{
  await expect(repo.editor(target).publish()).rejects.toMatchObject({code:'invalid'})
  expect(mocks.request).not.toHaveBeenCalled()
 })
 it('reads management even when no professional profile exists',async()=>{
  mocks.request.mockImplementation(()=>Promise.resolve(Response.json({profile:null,management:{available:true,managedByAdmin:true,version:2}})))
  expect(await repo.editor(target).getOwn()).toBeNull()
  expect(await repo.editor(target).getManagement!()).toEqual({available:true,managedByAdmin:true,version:2})
 })
 it('keeps a mode command distinct from publication and paginates audit explicitly',async()=>{
  mocks.request.mockResolvedValueOnce(Response.json({available:true,managedByAdmin:true,version:3}))
  await repo.setManagement(target,true,2,context.commandId)
  expect(mocks.request).toHaveBeenCalledWith(target,'/management',{managed:true,version:2,commandId:context.commandId})
  mocks.request.mockResolvedValueOnce(Response.json({entries:[]}));await repo.history(target,50)
  expect(mocks.request).toHaveBeenLastCalledWith(target,'/history?offset=50',undefined)
 })
 it('shows safe errors for denied, stale, invalid, expired and unavailable responses',async()=>{
  for(const [status,code]of [[401,'session_expired'],[403,'profile_forbidden'],[409,'PT409'],[422,'invalid'],[503,'unavailable']] as const){
   mocks.request.mockResolvedValueOnce(Response.json({error:'private raw SQL and media paths'},{status}))
   await expect(repo.read(target)).rejects.toMatchObject({code})
  }
 })
})
