import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { registerPrivateAnalyticsRoutes } from './private-analytics.js'

describe('private analytics route', () => {
  it('rejects missing and read-only sessions without calling the store', async () => {
    const app = Fastify()
    const bundle = vi.fn().mockResolvedValue({ trainers: [] })
    registerPrivateAnalyticsRoutes(app, { bundle })
    expect((await app.inject({ url: '/v1/private-analytics' })).statusCode).toBe(401)
    expect((await app.inject({ url: '/v1/private-analytics', headers: { 'x-fit-pilot-session': 'pilot' } })).statusCode).toBe(403)
    expect(bundle).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns forbidden for a denied session and never caches the response', async () => {
    const app = Fastify()
    const bundle = vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { code: 'PT403' }))
    registerPrivateAnalyticsRoutes(app, { bundle })
    const result = await app.inject({ url: '/v1/private-analytics', headers: { 'x-fit-session': 'synthetic' } })
    expect(result.statusCode).toBe(403)
    expect(result.headers['cache-control']).toBe('no-store')
    expect(result.json()).toEqual({ error: 'analytics_forbidden' })
    await app.close()
  })

  it('returns data only from the session-aware store and fails closed on unexpected errors', async () => {
    const app = Fastify()
    const bundle = vi.fn().mockResolvedValueOnce({ trainers: [] }).mockRejectedValueOnce(new Error('unavailable'))
    registerPrivateAnalyticsRoutes(app, { bundle })
    const request = { url: '/v1/private-analytics', headers: { 'x-fit-session': 'synthetic' } }
    const success = await app.inject(request)
    expect(success.statusCode).toBe(200)
    expect(success.headers['cache-control']).toBe('no-store')
    expect(bundle).toHaveBeenCalledWith({ accessMode: 'read_write', token: 'synthetic' })
    expect((await app.inject(request)).statusCode).toBe(503)
    await app.close()
  })
})

describe('private analytics explorer',()=>{
  it('validates date ranges and bounds before querying and sanitizes errors',async()=>{
    const app=Fastify(),explore=vi.fn().mockResolvedValue({rows:[]})
    registerPrivateAnalyticsRoutes(app,{bundle:vi.fn(),explore})
    const request={method:'POST' as const,url:'/v1/private-analytics/explore',headers:{'x-fit-session':'synthetic'}}
    for(const payload of [{from:'2026-02-30',to:'2026-03-01'},{from:'2026-11-01',to:'2026-10-01'},{from:'2026-11-01',to:'2026-11-07',pageSize:10000},{from:'2026-11-01',to:'2026-11-07',sort:'name; drop table x'}]){
      expect((await app.inject({...request,payload})).statusCode).toBe(422)
    }
    expect(explore).not.toHaveBeenCalled()
    const success=await app.inject({...request,payload:{from:'2026-11-01',to:'2026-11-07'}})
    expect(success.statusCode).toBe(200);expect(success.headers['cache-control']).toBe('no-store')
    expect(explore).toHaveBeenCalledWith({accessMode:'read_write',token:'synthetic'},expect.objectContaining({page:1,pageSize:50,regularDays:2}))
    explore.mockRejectedValueOnce(Object.assign(new Error('private SQL'),{code:'PT403'}))
    expect((await app.inject({...request,payload:{from:'2026-11-01',to:'2026-11-07'}})).json()).toEqual({error:'analytics_forbidden'})
    expect((await app.inject({...request,headers:{},payload:{from:'2026-11-01',to:'2026-11-07'}})).statusCode).toBe(401)
    await app.close()
  })
})
