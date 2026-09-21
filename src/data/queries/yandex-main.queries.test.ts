import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_WORKOUT_REQUEST_TIMEOUT_MS } from './auth-fetch'
import { getResponseDiagnostics } from './request-diagnostics'
import { createYandexMainQueries } from './yandex-main.queries'

describe('Yandex main query timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('aborts a stalled Live write', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const queries = createYandexMainQueries('https://api.example', 'session')
    const request = queries.write('/v1/workout-sets/set-1/draft', 'PUT', {})
    const result = expect(request).rejects.toThrow('Live workout request timed out')
    await vi.advanceTimersByTimeAsync(LIVE_WORKOUT_REQUEST_TIMEOUT_MS)
    await result
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
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: { 'x-fit-request-id': '18940d82-9075-48d2-a847-8feee301b4d7' },
      }))
    const queries = createYandexMainQueries('https://api.example', 'session')

    await expect(queries.read('/v1/clients')).resolves.toMatchObject({ status: 200 })
    expect(fetchMock).toHaveBeenCalledTimes(2)

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
})
