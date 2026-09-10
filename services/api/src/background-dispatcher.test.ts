import { describe, expect, it, vi } from 'vitest'

import { BackgroundDispatcher } from './background-dispatcher.js'

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

    await expect(new BackgroundDispatcher(push, appFeedback).run(now)).resolves.toEqual({
      claimed: 1,
      discarded: 0,
      failed: 0,
      remindersEnqueued: 1,
      succeeded: 1,
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
  })
})
