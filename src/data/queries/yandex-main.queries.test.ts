import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_WORKOUT_REQUEST_TIMEOUT_MS } from './auth-fetch'
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
})
