import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import { ClientProfilePhotoError, readClientPhotoUpload } from './client-profile-photo.js'

const id = '11111111-1111-4111-8111-111111111111'
const bytes = Buffer.from([255,216,255,217])
const photo = { dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`, mimeType:'image/jpeg', width:1,height:1,sizeBytes:4 }
const apps: ReturnType<typeof buildApp>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })
describe('client photo boundary', () => {
  it('rejects malformed and oversized image uploads', () => {
    expect(readClientPhotoUpload(photo)?.bytes).toEqual(bytes)
    for (const value of [null,{}, {...photo,sizeBytes:1},{...photo,width:961}, {...photo,mimeType:'image/svg+xml'}, {...photo,dataUrl:'data:image/jpeg;base64,AAAA'}]) expect(readClientPhotoUpload(value)).toBeUndefined()
  })
  it('requires an authenticated write session and valid version before upload', async () => {
    const upload = vi.fn(() => Promise.resolve({url:'https://example.test/private-photo',version:1}))
    const app = buildApp({pilotClientPhotos:{upload,read:vi.fn()},logger:false}); apps.push(app)
    const url = `/v1/clients/${id}/photo`, payload = {photo,expectedVersion:0}
    expect((await app.inject({method:'PUT',url,payload})).statusCode).toBe(401)
    expect((await app.inject({method:'PUT',url,payload,headers:{'x-fit-pilot-session':'pilot'}})).statusCode).toBe(403)
    expect((await app.inject({method:'PUT',url,payload:{...payload,expectedVersion:-1},headers:{'x-fit-session':'app'}})).statusCode).toBe(400)
    expect(upload).not.toHaveBeenCalled()
    const result=await app.inject({method:'PUT',url,payload,headers:{'x-fit-session':'app'}})
    expect(result.statusCode).toBe(200)
    expect(result.headers['cache-control']).toBe('no-store')
    expect(upload).toHaveBeenCalledWith({accessMode:'read_write',token:'app'},id,0,expect.objectContaining({bytes}))
  })
  it.each([['forbidden',403],['conflict',409],['unavailable',503]] as const)('reports %s without claiming success', async (failure,status) => {
    const app=buildApp({pilotClientPhotos:{read:vi.fn(),upload:vi.fn(()=>Promise.reject(new ClientProfilePhotoError(failure)))},logger:false});apps.push(app)
    const result=await app.inject({method:'PUT',url:`/v1/clients/${id}/photo`,payload:{photo,expectedVersion:0},headers:{'x-fit-session':'app'}})
    expect(result.statusCode).toBe(status)
  })
})
