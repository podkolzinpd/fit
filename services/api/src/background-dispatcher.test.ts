import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BackgroundDispatcher } from './background-dispatcher.js'

const pushSummary = { claimed: 1, discarded: 0, failed: 0, remindersEnqueued: 1, succeeded: 1 }
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('BackgroundDispatcher', () => {
  it('runs push and app-feedback jobs in the same timer invocation', async () => {
    const push = {
      run: vi.fn(() => Promise.resolve({
        claimed: 1,
        discarded: 0,
        failed: 0,
        remindersEnqueued: 1,
        succeeded: 1,
      })),
    }
    const appFeedback = {
      run: vi.fn(() => Promise.resolve({
        claimed: 1,
        trackerSucceeded: 1,
        trackerFailed: 0,
        trackerDiscarded: 0,
        telegramSucceeded: 1,
        telegramFailed: 0,
        telegramDiscarded: 0,
      })),
    }
    const now = new Date('2026-09-04T12:01:00.000Z')

    const cleanup = { run: vi.fn().mockResolvedValue({ deleted: 2 }) }
    await expect(new BackgroundDispatcher(push, appFeedback, cleanup).run(now)).resolves.toEqual({
      claimed: 1,
      discarded: 0,
      failed: 0,
      remindersEnqueued: 1,
      succeeded: 1,
      sessionCleanup: { status: 'cleaned', deleted: 2 },
      appFeedback: {
        claimed: 1,
        trackerSucceeded: 1,
        trackerFailed: 0,
        trackerDiscarded: 0,
        telegramSucceeded: 1,
        telegramFailed: 0,
        telegramDiscarded: 0,
      },
    })
    expect(push.run).toHaveBeenCalledWith(now)
    expect(appFeedback.run).toHaveBeenCalledWith(now)
    expect(cleanup.run).toHaveBeenCalledExactlyOnceWith()
  })

  it('runs cleanup without optional feedback and uses only the database clock', async () => {
    const cleanup = { run: vi.fn().mockResolvedValue({ deleted: 0 }) }
    await expect(new BackgroundDispatcher({ run: () => Promise.resolve(pushSummary) }, undefined, cleanup).run()).resolves.toEqual({
      ...pushSummary, sessionCleanup: { status: 'cleaned', deleted: 0 },
    })
    expect(cleanup.run).toHaveBeenCalledExactlyOnceWith()
    expect(console.info).toHaveBeenCalledWith(JSON.stringify({ level: 'INFO', event: 'yandex_session_cleanup', deleted: 0 }))
  })

  it('isolates cleanup failure and retries only on the next invocation without leaking error details', async () => {
    const failure = Object.assign(new Error('private connection details'), { code: 'ECONNRESET' })
    const cleanup = { run: vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({ deleted: 1 }) }
    const push = { run: vi.fn().mockResolvedValue(pushSummary) }
    const dispatcher = new BackgroundDispatcher(push, undefined, cleanup)
    await expect(dispatcher.run()).resolves.toEqual({ ...pushSummary, sessionCleanup: { status: 'failed' } })
    expect(cleanup.run).toHaveBeenCalledOnce()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('yandex_session_cleanup_failed'))
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private')
    await expect(dispatcher.run()).resolves.toEqual({ ...pushSummary, sessionCleanup: { status: 'cleaned', deleted: 1 } })
    expect(push.run).toHaveBeenCalledTimes(2)
    expect(cleanup.run).toHaveBeenCalledTimes(2)
  })

  it('waits for cleanup even when notification delivery fails', async () => {
    let finish: ((result: { deleted: number }) => void) | undefined
    const cleanupResult = new Promise<{ deleted: number }>((resolve) => { finish = resolve })
    const failure = new Error('push failed')
    const dispatcher = new BackgroundDispatcher({ run: () => Promise.reject(failure) }, undefined, { run: () => cleanupResult })
    const result = dispatcher.run()
    let settled = false
    const assertion = expect(result.finally(() => { settled = true })).rejects.toBe(failure)
    await Promise.resolve()
    expect(settled).toBe(false)
    if (finish === undefined) throw new Error('cleanup not started')
    finish({ deleted: 2 })
    await assertion
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"deleted":2'))
  })
})
