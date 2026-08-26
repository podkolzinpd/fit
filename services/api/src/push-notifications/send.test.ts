import { describe, expect, it, vi } from 'vitest'

const sendNotification = vi.fn()
vi.mock('web-push', () => ({ default: { sendNotification: (...args: unknown[]): unknown => sendNotification(...args) } }))

const { sendPushNotification, sendPushNotifications } = await import('./send.js')

const input = {
  id: 'notif-1',
  subscription: { endpoint: 'https://push.example/ep1', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } },
  title: 'Тренировка сегодня',
  body: 'Запланирована на 09:00',
  data: { workout_id: 'workout-1' },
}
const vapid = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:team@example.test' }

describe('sendPushNotification', () => {
  it('reports success when web-push delivers the message', async () => {
    sendNotification.mockResolvedValueOnce(undefined)
    const result = await sendPushNotification(input, vapid)
    expect(result).toEqual({ id: 'notif-1', ok: true })
    expect(sendNotification).toHaveBeenCalledWith(
      input.subscription,
      JSON.stringify({ title: input.title, body: input.body, data: input.data }),
      { vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey } },
    )
  })

  it('reports the push service status code on a gone subscription', async () => {
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('subscription expired'), { statusCode: 410 }))
    const result = await sendPushNotification(input, vapid)
    expect(result).toEqual({ id: 'notif-1', ok: false, status: 410, error: 'subscription expired' })
  })

  it('falls back to status 0 for a non-HTTP failure', async () => {
    sendNotification.mockRejectedValueOnce(new Error('network unreachable'))
    const result = await sendPushNotification(input, vapid)
    expect(result).toEqual({ id: 'notif-1', ok: false, status: 0, error: 'network unreachable' })
  })
})

describe('sendPushNotifications', () => {
  it('sends every notification independently and preserves ids', async () => {
    sendNotification.mockResolvedValueOnce(undefined)
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 404 }))
    const results = await sendPushNotifications(
      [input, { ...input, id: 'notif-2' }],
      vapid,
    )
    expect(results).toEqual([
      { id: 'notif-1', ok: true },
      { id: 'notif-2', ok: false, status: 404, error: 'gone' },
    ])
  })
})
