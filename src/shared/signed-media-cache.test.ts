import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSignedUrlCache } from './signed-media-cache'

describe('signed media cache', () => {
  afterEach(() => { vi.useRealTimers() })

  it('keeps the original expiry when a mounted consumer reuses a URL', async () => {
    vi.useFakeTimers()
    const cache = createSignedUrlCache(100)
    const sign = vi.fn().mockResolvedValue('https://signed.example/first')
    const first = await cache.resolveWithExpiry('poster', sign)
    vi.advanceTimersByTime(90)
    expect(await cache.resolveWithExpiry('poster', sign)).toEqual(first)
    expect(sign).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(10)
    await cache.resolveWithExpiry('poster', sign)
    expect(sign).toHaveBeenCalledTimes(2)
  })

  it('invalidates only the failed URL without removing another consumer refresh', async () => {
    const cache = createSignedUrlCache(100)
    const sign = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new')
    await cache.resolve('poster', sign)
    cache.invalidate('poster', 'old')
    const refresh = cache.resolve('poster', sign)
    cache.invalidate('poster', 'old')
    expect(await cache.resolve('poster', sign)).toBe('new')
    expect(await refresh).toBe('new')
    cache.invalidate('poster', 'old')
    expect(await cache.resolve('poster', sign)).toBe('new')
    expect(sign).toHaveBeenCalledTimes(2)
  })

  it('does not remove a newer entry when an expired in-flight request rejects', async () => {
    vi.useFakeTimers()
    const cache = createSignedUrlCache(100)
    let rejectOld: (error: Error) => void = () => {}
    const old = cache.resolve('poster', () => new Promise<string>((_resolve, reject) => { rejectOld = reject }))
    const oldRejected = expect(old).rejects.toThrow('old failure')
    await Promise.resolve()
    vi.advanceTimersByTime(101)
    const sign = vi.fn().mockResolvedValue('new')
    expect(await cache.resolve('poster', sign)).toBe('new')
    rejectOld(new Error('old failure'))
    await oldRejected
    expect(await cache.resolve('poster', sign)).toBe('new')
    expect(sign).toHaveBeenCalledOnce()
  })
})
