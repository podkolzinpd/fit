import { describe, expect, it } from 'vitest'

import {
  readNotificationPreferenceRequest,
  readPushNotificationKind,
  readPushSubscriptionRequest,
} from './push-notifications-request.js'

describe('readPushSubscriptionRequest', () => {
  it('normalizes a valid HTTPS browser subscription without accepting an actor', () => {
    expect(readPushSubscriptionRequest({
      endpoint: ' https://push.example/subscription ',
      p256dh: ' public-key ',
      authKey: ' auth-secret ',
      userId: '974f21af-f304-421f-81bd-050dbfabdd46',
    })).toEqual({
      endpoint: 'https://push.example/subscription',
      p256dh: 'public-key',
      authKey: 'auth-secret',
    })
  })

  it.each([
    [{ endpoint: 'http://push.example/subscription', p256dh: 'key', authKey: 'secret' }],
    [{ endpoint: 'https://user:password@push.example/subscription', p256dh: 'key', authKey: 'secret' }],
    [{ endpoint: 'not-a-url', p256dh: 'key', authKey: 'secret' }],
    [{ endpoint: 'https://push.example/subscription', p256dh: '', authKey: 'secret' }],
    [{ endpoint: 'https://push.example/subscription', p256dh: 'key', authKey: ' ' }],
    [{ endpoint: 'https://push.example/subscription', p256dh: 'key' }],
  ])('rejects malformed or incomplete subscriptions', (body) => {
    expect(readPushSubscriptionRequest(body)).toBeUndefined()
  })
})

describe('notification preference requests', () => {
  it('accepts both supported notification kinds', () => {
    expect(readPushNotificationKind(' WORKOUT_REMINDER ')).toBe('workout_reminder')
    expect(readPushNotificationKind('workout_scheduled')).toBe('workout_scheduled')
  })

  it('rejects unknown notification kinds', () => {
    expect(readPushNotificationKind('marketing')).toBeUndefined()
  })

  it('requires an explicit boolean preference', () => {
    expect(readNotificationPreferenceRequest({ enabled: false })).toEqual({ enabled: false })
    expect(readNotificationPreferenceRequest({ enabled: 'false' })).toBeUndefined()
  })
})
