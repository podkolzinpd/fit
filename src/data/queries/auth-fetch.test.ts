import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH_PASSWORD_REQUEST_TIMEOUT_MS, createAuthFetch } from './auth-fetch'

describe('createAuthFetch', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('прерывает зависший password sign-in запрос по таймауту', async () => {
    vi.useFakeTimers()
    const fetchImplementation = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const authFetch = createAuthFetch(fetchImplementation)

    const request = authFetch('https://example.supabase.co/auth/v1/token?grant_type=password', { method: 'POST' })
    const result = expect(request).rejects.toThrow('Auth sign-in request timed out')

    await vi.advanceTimersByTimeAsync(AUTH_PASSWORD_REQUEST_TIMEOUT_MS)
    await result
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('не ограничивает остальные запросы Supabase auth-таймаутом', async () => {
    vi.useFakeTimers()
    const response = new Response(null, { status: 204 })
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(response)
    const authFetch = createAuthFetch(fetchImplementation)

    await expect(authFetch('https://example.supabase.co/rest/v1/profiles')).resolves.toBe(response)
    await vi.advanceTimersByTimeAsync(AUTH_PASSWORD_REQUEST_TIMEOUT_MS)
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })
})
