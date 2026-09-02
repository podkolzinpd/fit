import { describe, expect, it, vi } from 'vitest'

import { YandexPushNotificationSender } from './http-sender.js'

const notifications = [{
  id: '780e135d-b64e-4415-a934-3c649236808b',
  subscription: {
    endpoint: 'https://push.example/subscription',
    keys: { p256dh: 'public-key', auth: 'auth-key' },
  },
  title: 'Тренировка сегодня',
  body: 'Запланирована на 09:00',
  data: { workout_id: '436af949-dd4e-4263-bc8a-56dd22f1a635' },
}]

describe('YandexPushNotificationSender', () => {
  it('calls only the Yandex sender with the custom secret header', async () => {
    const fetch_: typeof fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      results: [{ id: notifications[0]!.id, ok: true }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const sender = new YandexPushNotificationSender(
      'https://functions.yandexcloud.net/function-id',
      'a'.repeat(32),
      fetch_,
    )

    await expect(sender.send(notifications)).resolves.toEqual([{
      id: notifications[0]!.id,
      ok: true,
    }])
    expect(fetch_).toHaveBeenCalledWith(
      'https://functions.yandexcloud.net/function-id',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-push-dispatch-secret': 'a'.repeat(32),
        },
      }),
    )
  })

  it('sanitizes provider failures before finalization', async () => {
    const fetch_: typeof fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      results: [{
        id: notifications[0]!.id,
        ok: false,
        status: 410,
        error: 'https://push.example/private-endpoint is gone',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const sender = new YandexPushNotificationSender(
      'https://functions.yandexcloud.net/function-id',
      'b'.repeat(32),
      fetch_,
    )

    await expect(sender.send(notifications)).resolves.toEqual([{
      id: notifications[0]!.id,
      ok: false,
      status: 410,
      error: 'web_push_410',
    }])
  })

  it('rejects incomplete and duplicated result sets', async () => {
    const fetch_: typeof fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      results: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const sender = new YandexPushNotificationSender(
      'https://functions.yandexcloud.net/function-id',
      'c'.repeat(32),
      fetch_,
    )

    await expect(sender.send(notifications)).rejects.toThrow(
      'Push sender returned an incomplete result set',
    )
  })

  it('rejects non-Yandex URLs and short secrets', () => {
    expect(() => new YandexPushNotificationSender(
      'https://example.com/function-id',
      'd'.repeat(32),
    )).toThrow('PUSH_FUNCTION_URL')
    expect(() => new YandexPushNotificationSender(
      'https://functions.yandexcloud.net/function-id',
      'short',
    )).toThrow('PUSH_DISPATCH_SECRET')
  })
})
