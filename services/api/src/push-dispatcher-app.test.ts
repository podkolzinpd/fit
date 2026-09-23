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
  it('closes response sockets instead of reusing them after container suspension', async () => {
    const app = buildPushDispatcherApp({
      dispatcher: { run: vi.fn() },
      logger: false,
      releaseId: 'release-1',
    })

    expect(app.server.maxRequestsPerSocket).toBe(1)
    expect(app.server.keepAliveTimeout).toBe(5_000)
    await app.close()
  })

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
    const logs: string[] = []
    const run = vi.fn(() => Promise.resolve({
      claimed: 1,
      discarded: 0,
      failed: 0,
      remindersEnqueued: 1,
      succeeded: 1,
    }))
    const app = buildPushDispatcherApp({
      dispatcher: { run },
      logger: { stream: { write: (message) => { logs.push(message) } } },
      releaseId: 'release-1',
    })

    const response = await app.inject({
      method: 'POST',
      url: '/internal/push/dispatch',
      headers: { 'x-request-id': 'd1d053a1-3207-4926-87d3-e65ff8e4a7d6' },
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
    const records: unknown[] = logs.map((line) => JSON.parse(line) as unknown)
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        request_id: 'd1d053a1-3207-4926-87d3-e65ff8e4a7d6',
        stage: 'received',
      }),
      expect.objectContaining({
        request_id: 'd1d053a1-3207-4926-87d3-e65ff8e4a7d6',
        stage: 'completed',
      }),
    ]))
    expect(logs.find((line) => line.includes('"stage":"completed"')))
      .toMatch(/"durationMs":\d+/)
    await app.close()
  })

  it('rejects a direct or malformed invocation without dispatching', async () => {
    const logs: string[] = []
    const run = vi.fn()
    const app = buildPushDispatcherApp({
      dispatcher: { run },
      logger: { stream: { write: (message) => { logs.push(message) } } },
      releaseId: 'release-1',
    })

    const response = await app.inject({
      method: 'POST',
      url: '/internal/push/dispatch',
      headers: { 'x-request-id': 'not-a-valid-request-id' },
      payload: { messages: [] },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ status: 'invalid_timer_event' })
    expect(run).not.toHaveBeenCalled()
    expect(logs.join('')).not.toContain('not-a-valid-request-id')
    expect(logs.map((line) => JSON.parse(line) as unknown)).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'rejected' }),
    ]))
    await app.close()
  })

  it('returns a retryable failure without exposing the internal error', async () => {
    const logs: string[] = []
    const app = buildPushDispatcherApp({
      dispatcher: {
        run: vi.fn(() => Promise.reject(new Error('database secret'))),
      },
      logger: { stream: { write: (message) => { logs.push(message) } } },
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
    expect(logs.join('')).not.toContain('database secret')
    expect(logs.map((line) => JSON.parse(line) as unknown)).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'failed', errorType: 'Error' }),
    ]))
    await app.close()
  })
})
