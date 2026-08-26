import { describe, expect, it } from 'vitest'

import { parsePushRequest, PushRequestError } from './parse-request.js'

const validNotification = {
  id: 'notif-1',
  subscription: { endpoint: 'https://push.example/ep1', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } },
  title: 'Тренировка сегодня',
  body: 'Запланирована на 09:00',
  data: { workout_id: 'workout-1' },
}

describe('parsePushRequest', () => {
  it('parses a valid batch', () => {
    const result = parsePushRequest({ notifications: [validNotification] })
    expect(result).toEqual([validNotification])
  })

  it('defaults data to an empty object when omitted', () => {
    const withoutData: Record<string, unknown> = { ...validNotification }
    delete withoutData.data
    const result = parsePushRequest({ notifications: [withoutData] })
    expect(result[0]?.data).toEqual({})
  })

  it('rejects a missing notifications array', () => {
    expect(() => parsePushRequest({})).toThrow(PushRequestError)
  })

  it('rejects an empty notifications array', () => {
    expect(() => parsePushRequest({ notifications: [] })).toThrow(PushRequestError)
  })

  it('rejects more than 50 notifications in one batch', () => {
    const notifications = Array.from({ length: 51 }, (_, index) => ({ ...validNotification, id: `notif-${index}` }))
    expect(() => parsePushRequest({ notifications })).toThrow(PushRequestError)
  })

  it('rejects a notification missing subscription keys', () => {
    const invalid = { ...validNotification, subscription: { endpoint: 'https://push.example/ep1', keys: { p256dh: 'k' } } }
    expect(() => parsePushRequest({ notifications: [invalid] })).toThrow(PushRequestError)
  })

  it('rejects a notification with a blank title', () => {
    const invalid = { ...validNotification, title: '' }
    expect(() => parsePushRequest({ notifications: [invalid] })).toThrow(PushRequestError)
  })
})
