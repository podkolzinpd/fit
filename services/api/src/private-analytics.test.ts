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
