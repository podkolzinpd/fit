import { afterEach, describe, expect, it, vi } from 'vitest'

import { handler } from './yandex-workout-parser-function.js'

describe('production Yandex workout parser adapter', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('answers CORS preflight', async () => {
    const result = await handler({ httpMethod: 'OPTIONS', headers: { origin: 'https://fit.example.test' } })

    expect(result.statusCode).toBe(204)
    expect(result.headers).toMatchObject({ 'access-control-allow-origin': 'https://fit.example.test' })
    expect(result.body).toBe('')
  })

  it('requires a Fit session before proxying to the native API', async () => {
    const result = await handler({ httpMethod: 'POST', body: '{}' })

    expect(result.statusCode).toBe(401)
    expect(result.body).toBe('{"error":"unauthorized"}')
  })

  it.each([
    { path: '/v1/assistant/yandex/parse-workout', header: 'x-fit-session', body: { text: 'fixture workout' } },
    { path: '/v1/assistant/yandex/suggest-goal-criteria', header: 'x-fit-pilot-session', body: { kind: 'goal', text: 'fixture goal' } },
  ])('proxies $path with its Fit session and unchanged payload', async ({ path, header, body }) => {
    vi.stubEnv('FIT_API_BASE_URL', 'https://fit-api.example/')
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"fixture":true}', {
      status: 200, headers: { 'content-type': 'application/json', 'x-fit-request-id': 'fixture-request' },
    }))
    vi.stubGlobal('fetch', request)
    const raw = JSON.stringify(body)

    const result = await handler({ httpMethod: 'POST', headers: { [header]: 'fixture-session' }, body: raw })

    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]?.[0]).toBe(`https://fit-api.example${path}`)
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST', body: raw,
      headers: { 'content-type': 'application/json', [header]: 'fixture-session' },
    })
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false)
    expect(result.statusCode).toBe(200)
    expect(result.headers).toMatchObject({ 'content-type': 'application/json', 'x-fit-request-id': 'fixture-request' })
    expect(result.body).toBe('{"fixture":true}')
  })

  it('fails safely without a configured native API URL and makes no request', async () => {
    vi.stubEnv('FIT_API_BASE_URL', '')
    const request = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', request)

    const result = await handler({ httpMethod: 'POST', headers: { 'x-fit-session': 'fixture-session' }, body: '{}' })

    expect(result.statusCode).toBe(503)
    expect(result.body).toBe('{"error":"service_unavailable"}')
    expect(request).not.toHaveBeenCalled()
  })

  it('passes native authorization errors through without fallback', async () => {
    vi.stubEnv('FIT_API_BASE_URL', 'https://fit-api.example')
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"error":"forbidden"}', {
      status: 403, headers: { 'x-fit-error-code': 'forbidden', 'x-fit-request-id': 'fixture-denied' },
    }))
    vi.stubGlobal('fetch', request)

    const result = await handler({ httpMethod: 'POST', headers: { 'x-fit-session': 'fixture-session' }, body: '{}' })

    expect(request).toHaveBeenCalledOnce()
    expect(result.statusCode).toBe(403)
    expect(result.headers).toMatchObject({ 'x-fit-error-code': 'forbidden', 'x-fit-request-id': 'fixture-denied' })
    expect(result.body).toBe('{"error":"forbidden"}')
  })
})
