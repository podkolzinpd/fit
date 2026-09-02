import { describe, expect, it, vi } from 'vitest'

import { buildPushDispatcherApp } from './push-dispatcher-app.js'

const timerEvent = {
  messages: [{
    event_metadata: {
      event_type: 'yandex.cloud.events.serverless.triggers.TimerMessage',
    },
    details: { payload: 'sync-push-notifications' },
  }],
}

describe('push dispatcher private container', () => {
  it('exposes a side-effect-free health endpoint', async () => {
    const run = vi.fn()
    const app = buildPushDispatcherApp({
      dispatcher: { run },
      logger: false,
      releaseId: 'release-1',
    })

    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ releaseId: 'release-1', status: 'ok' })
    expect(run).not.toHaveBeenCalled()
    await app.close()
  })

  it('runs only for the exact Yandex timer event', async () => {
    const run = vi.fn(() => Promise.resolve({
      claimed: 1,
      discarded: 0,
      failed: 0,
      remindersEnqueued: 1,
      succeeded: 1,
    }))
    const app = buildPushDispatcherApp({
      dispatcher: { run },
      logger: false,
      releaseId: 'release-1',
    })

    const response = await app.inject({
      method: 'POST',
      url: '/internal/push/dispatch',
      payload: timerEvent,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'dispatched',
      claimed: 1,
      discarded: 0,
      failed: 0,
      remindersEnqueued: 1,
      succeeded: 1,
    })
    expect(run).toHaveBeenCalledOnce()
    await app.close()
  })

  it('rejects a direct or malformed invocation without dispatching', async () => {
    const run = vi.fn()
    const app = buildPushDispatcherApp({
      dispatcher: { run },
      logger: false,
      releaseId: 'release-1',
    })

    const response = await app.inject({
      method: 'POST',
      url: '/internal/push/dispatch',
      payload: { messages: [] },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ status: 'invalid_timer_event' })
    expect(run).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns a retryable failure without exposing the internal error', async () => {
    const app = buildPushDispatcherApp({
      dispatcher: {
        run: vi.fn(() => Promise.reject(new Error('database secret'))),
      },
      logger: false,
      releaseId: 'release-1',
    })

    const response = await app.inject({
      method: 'POST',
      url: '/internal/push/dispatch',
      payload: timerEvent,
    })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ status: 'dispatch_failed' })
    expect(response.body).not.toContain('database secret')
    await app.close()
  })
})
