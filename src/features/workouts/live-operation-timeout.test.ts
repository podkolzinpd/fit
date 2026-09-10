import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_RECOVERY_REQUEST_TIMEOUT_MS, liveOperationWithTimeout } from './live-operation-timeout'

describe('liveOperationWithTimeout', () => {
  afterEach(() => vi.useRealTimers())

  it('возвращает результат, если восстановление завершилось вовремя', async () => {
    await expect(liveOperationWithTimeout(Promise.resolve('saved'))).resolves.toBe('saved')
  })

  it('освобождает интерфейс, если восстановление зависло', async () => {
    vi.useFakeTimers()
    const result = expect(liveOperationWithTimeout(new Promise<never>(() => undefined)))
      .rejects.toThrow('Live recovery request timed out')

    await vi.advanceTimersByTimeAsync(LIVE_RECOVERY_REQUEST_TIMEOUT_MS)
    await result
  })
})
