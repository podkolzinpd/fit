import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_WORKOUT_REQUEST_TIMEOUT_MS } from './auth-fetch'
import { getRequestDiagnostics } from '../../shared/request-diagnostics'
import {
  getResponseDiagnostics,
  resetYandexPlatformRequestStateForTests,
} from './request-diagnostics'
import { createYandexMainQueries, YANDEX_MAIN_READ_TIMEOUT_MS } from './yandex-main.queries'

describe('Yandex main query timeout', () => {
  afterEach(() => {
    resetYandexPlatformRequestStateForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('aborts a stalled Live write', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input) === 'https://api.example/health') {
        return Promise.resolve(new Response('{}', {
          status: 200,
          headers: { 'x-fit-request-id': 'health-request-id' },
        }))
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    const queries = createYandexMainQueries('https://api.example', 'session')
    const request = queries.write('/v1/workout-sets/set-1/draft', 'PUT', {})
    const result = expect(request).rejects.toThrow('Live workout request timed out')
    await vi.advanceTimersByTimeAsync(LIVE_WORKOUT_REQUEST_TIMEOUT_MS)
    await result
  })

  it('aborts a read whose response body stalls', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => Promise.resolve(new Response(
      new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const queries = createYandexMainQueries('https://api.example', 'session')

    const request = queries.read('/v1/legal/acceptance')
    const result = expect(request).rejects.toThrow('Yandex data request timed out')
    await vi.advanceTimersByTimeAsync(YANDEX_MAIN_READ_TIMEOUT_MS)

    await result
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it('sends a correlation ID and keeps safe response diagnostics', async () => {
    const requestId = '18940d82-9075-48d2-a847-8feee301b4d7'
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: 'service_unavailable' }),
      {
        status: 503,
        headers: {
          'content-type': 'application/json',
          'x-fit-request-id': requestId,
          'x-fit-error-code': 'service_unavailable',
          'x-fit-release-id': 'release-42',
        },
      },
    ))
    const queries = createYandexMainQueries('https://api.example', 'session')

    const response = await queries.read('/v1/clients/1a0c5295-0a0f-4ccb-a39a-e58090967245')

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('x-fit-request-id')).toBe(requestId)
    expect(headers.get('x-fit-session')).toBe('session')
    const diagnostics = getResponseDiagnostics(response)
    expect(diagnostics?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(diagnostics).toEqual({
      requestId,
      occurredAt: diagnostics?.occurredAt,
      backend: 'yandex',
      operation: 'GET /v1/clients/:id',
      stage: 'api',
      status: 503,
      errorCode: 'service_unavailable',
      releaseId: 'release-42',
    })
  })

  it('retries one platform-level 502 for a read without repeating writes or app errors', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: { 'x-fit-request-id': 'health-request-id' },
      }))
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: { 'x-fit-request-id': '18940d82-9075-48d2-a847-8feee301b4d7' },
      }))
    const queries = createYandexMainQueries('https://api.example', 'session')

    const recoveredRead = queries.read('/v1/clients')
    await vi.advanceTimersByTimeAsync(250)
    await expect(recoveredRead).resolves.toMatchObject({ status: 200 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.example/health')
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ cache: 'no-store' }))
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has('x-fit-session')).toBe(false)

    fetchMock.mockClear()
    fetchMock.mockResolvedValueOnce(new Response(null, {
      status: 502,
      headers: { 'x-fit-request-id': '18940d82-9075-48d2-a847-8feee301b4d7' },
    }))
    await expect(queries.read('/v1/clients')).resolves.toMatchObject({ status: 502 })
    expect(fetchMock).toHaveBeenCalledOnce()

    fetchMock.mockClear()
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 502 }))
    await expect(queries.write('/v1/clients', 'POST', {})).resolves.toMatchObject({ status: 502 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('retries one browser-hidden platform failure for a read without repeating writes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: { 'x-fit-request-id': 'health-request-id' },
      }))
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: { 'x-fit-request-id': '18940d82-9075-48d2-a847-8feee301b4d7' },
      }))
    const queries = createYandexMainQueries('https://api.example', 'session')

    const recoveredRead = queries.read('/v1/legal/acceptance')
    await vi.advanceTimersByTimeAsync(250)
    await expect(recoveredRead).resolves.toMatchObject({ status: 200 })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    fetchMock.mockClear()
    fetchMock.mockRejectedValueOnce(new TypeError('Load failed'))
    await expect(queries.write('/v1/legal/acceptance', 'PUT', {})).rejects.toThrow('Load failed')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('warms a stale runtime before sending a mutation exactly once', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: { 'x-fit-request-id': 'health-request-id' },
      }))
      .mockResolvedValueOnce(new Response('{}', {
        status: 201,
        headers: { 'x-fit-request-id': 'write-request-id' },
      }))
    const queries = createYandexMainQueries('https://stale-api.example', 'session')

    const write = queries.write('/v1/clients', 'POST', {})
    await vi.advanceTimersByTimeAsync(250)

    await expect(write).resolves.toMatchObject({ status: 201 })
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://stale-api.example/health',
      'https://stale-api.example/health',
      'https://stale-api.example/v1/clients',
    ])
  })

  it.each([1200, 2192, 4500])('saves a template once when a healthy probe takes %ims', async (delayMs) => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (!String(input).endsWith('/health')) return Promise.resolve(new Response('{}', { status: 201 }))
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('{}', { headers: { 'x-fit-request-id': 'healthy-probe' } })), delayMs)
        init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
      })
    })
    const command = { draft: { id: 'fixture', name: 'План' }, expectedVersion: null }
    const write = createYandexMainQueries('https://slow-api.example', 'session').write('/v1/workout-templates', 'POST', command)
    await vi.advanceTimersByTimeAsync(delayMs)
    await expect(write).resolves.toMatchObject({ status: 201 })
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(['https://slow-api.example/health', 'https://slow-api.example/v1/workout-templates'])
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(command))
  })

  it('uses the longer probe on recovery after an immediate platform failure too', async () => {
    vi.useFakeTimers()
    let probes = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (!String(input).endsWith('/health')) return Promise.resolve(new Response('{}', { status: 201 }))
      if (++probes === 1) return Promise.resolve(new Response(null, { status: 502 }))
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('{}', { headers: { 'x-fit-request-id': 'healthy-probe' } })), 2192)
        init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
      })
    })
    const write = createYandexMainQueries('https://recovering-api.example', 'session').write('/v1/workout-templates', 'POST', {})
    await vi.advanceTimersByTimeAsync(2442)
    await expect(write).resolves.toMatchObject({ status: 201 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('bounds a stalled template preflight to 10 seconds and exposes its distinct diagnostic', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const queries = createYandexMainQueries('https://stalled-api.example', 'session')
    const outcome = queries.write('/v1/workout-templates', 'POST', {}).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10_000)
    const error = await outcome
    expect(error).toBeInstanceOf(Error)
    expect(getRequestDiagnostics(error)).toMatchObject({ operation: 'POST /v1/workout-templates', stage: 'network', errorCode: 'mutation_preflight_failed' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([input]) => String(input).endsWith('/health'))).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shares a slow mutation preflight without duplicating either write', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => String(input).endsWith('/health')
      ? new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('{}', { headers: { 'x-fit-request-id': 'healthy-probe' } })), 2192))
      : Promise.resolve(new Response('{}', { status: 201 })))
    const queries = createYandexMainQueries('https://shared-api.example', 'session')
    const writes = [queries.write('/v1/workout-templates', 'POST', { draft: { id: 'first' } }), queries.write('/v1/workout-templates/second', 'PUT', { draft: { id: 'second' } })]
    await vi.advanceTimersByTimeAsync(2192)
    await expect(Promise.all(writes)).resolves.toHaveLength(2)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/health'))).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
  })

  it('does not send a cancelled Live mutation after its slow shared preflight finishes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>((resolve) => {
      setTimeout(() => resolve(new Response('{}', { headers: { 'x-fit-request-id': 'healthy-probe' } })), 2192)
    }))
    const controller = new AbortController()
    const { fetchWithRequestDiagnostics } = await import('./request-diagnostics')
    const write = fetchWithRequestDiagnostics(globalThis.fetch, 'https://cancelled-api.example/v1/workout-sets/set-1/confirm', { method: 'POST', signal: controller.signal })
    const result = expect(write).rejects.toThrow(/aborted/i)
    controller.abort()
    await result
    await vi.advanceTimersByTimeAsync(2192)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cancelled-api.example/health')
  })

  it('does not send a mutation when the runtime cannot be prepared', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 502 }))
    const queries = createYandexMainQueries('https://unavailable-api.example', 'session')

    const write = queries.write('/v1/clients', 'POST', {})
    const result = expect(write).rejects.toThrow('Не удалось подготовить соединение с Yandex Cloud.')
    await vi.advanceTimersByTimeAsync(5_500)

    await result
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(fetchMock.mock.calls.every(([input]) => String(input).endsWith('/health'))).toBe(true)
  })

  it('skips the mutation preflight after a recent request reached the API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: { 'x-fit-request-id': 'read-request-id' },
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 204,
        headers: { 'x-fit-request-id': 'write-request-id' },
      }))
    const queries = createYandexMainQueries('https://active-api.example', 'session')

    await queries.read('/v1/clients')
    await queries.write('/v1/legal/acceptance', 'PUT', {})

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://active-api.example/v1/clients',
      'https://active-api.example/v1/legal/acceptance',
    ])
  })

  it('shares one platform recovery probe across concurrent reads', async () => {
    vi.useFakeTimers()
    let readAttempts = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (String(input) === 'https://api.example/health') {
        return Promise.resolve(new Response('{}', {
          status: 200,
          headers: { 'x-fit-request-id': 'health-request-id' },
        }))
      }
      readAttempts += 1
      return Promise.resolve(readAttempts <= 2
        ? new Response(null, { status: 502 })
        : new Response('{}', {
            status: 200,
            headers: { 'x-fit-request-id': `read-request-${readAttempts}` },
          }))
    })
    const queries = createYandexMainQueries('https://api.example', 'session')

    const clients = queries.read('/v1/clients')
    const connections = queries.read('/v1/connections')
    await vi.advanceTimersByTimeAsync(250)

    await expect(Promise.all([clients, connections])).resolves.toEqual([
      expect.objectContaining({ status: 200 }),
      expect.objectContaining({ status: 200 }),
    ])
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/health'))).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('keeps the original response when the platform does not recover', async () => {
    vi.useFakeTimers()
    const originalResponse = new Response(null, { status: 502 })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(originalResponse)
      .mockResolvedValue(new Response(null, { status: 502 }))
    const queries = createYandexMainQueries('https://api.example', 'session')

    const unavailableRead = queries.read('/v1/clients')
    await vi.advanceTimersByTimeAsync(5_500)

    await expect(unavailableRead).resolves.toBe(originalResponse)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/health'))).toHaveLength(4)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})
