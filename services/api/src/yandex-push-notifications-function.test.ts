import { afterEach, describe, expect, it, vi } from 'vitest'

const sendNotification = vi.fn()
vi.mock('web-push', () => ({ default: { sendNotification: (...args: unknown[]): unknown => sendNotification(...args) } }))

const { handler } = await import('./yandex-push-notifications-function.js')

const ENV_KEYS = ['PUSH_DISPATCH_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const

function setEnv() {
  process.env.PUSH_DISPATCH_SECRET = 'test-secret'
  process.env.VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
  process.env.VAPID_SUBJECT = 'mailto:team@example.test'
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  sendNotification.mockReset()
})

const validNotification = {
  id: 'notif-1',
  subscription: { endpoint: 'https://push.example/ep1', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } },
  title: 'Тренировка сегодня',
  body: 'Запланирована на 09:00',
  data: { workout_id: 'workout-1' },
}

describe('production Yandex push notifications function', () => {
  it('answers CORS preflight without checking auth', async () => {
    const result = await handler({ httpMethod: 'OPTIONS' })
    expect(result.statusCode).toBe(204)
  })

  it('rejects a call without the shared dispatch secret', async () => {
    setEnv()
    const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ notifications: [validNotification] }) })
    expect(result.statusCode).toBe(401)
  })

  it('rejects a wrong bearer secret', async () => {
    setEnv()
    const result = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
      body: JSON.stringify({ notifications: [validNotification] }),
    })
    expect(result.statusCode).toBe(401)
  })

  it('rejects an invalid batch shape with the shared secret present', async () => {
    setEnv()
    const result = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer test-secret' },
      body: JSON.stringify({ notifications: [] }),
    })
    expect(result.statusCode).toBe(400)
  })

  it('sends the batch and returns per-notification results', async () => {
    setEnv()
    sendNotification.mockResolvedValueOnce(undefined)
    const result = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer test-secret' },
      body: JSON.stringify({ notifications: [validNotification] }),
    })
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ results: [{ id: 'notif-1', ok: true }] })
  })
})
