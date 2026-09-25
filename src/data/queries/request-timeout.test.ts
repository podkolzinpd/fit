import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout } from './request-timeout'

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the deadline active until the full response body is available', async () => {
    vi.useFakeTimers()
    const stalledBody = new ReadableStream<Uint8Array>({ start: () => undefined })
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(stalledBody, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const request = fetchWithTimeout(
      fetchImplementation,
      'https://api.example.test/session',
      undefined,
      100,
      'Session request timed out',
    )
    const assertion = expect(request).rejects.toThrow('Session request timed out')

    await vi.advanceTimersByTimeAsync(100)
    await assertion
  })

  it('returns a reusable response after buffering a successful body', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ status: 'ok' }),
      { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' } },
    ))

    const response = await fetchWithTimeout(
      fetchImplementation,
      'https://api.example.test/session',
      undefined,
      100,
      'Session request timed out',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBe('req-1')
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
