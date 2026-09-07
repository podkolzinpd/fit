import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSubscriptionByEndpoint = vi.hoisted(() => vi.fn())
const getPreference = vi.hoisted(() => vi.fn())
const upsertSubscription = vi.hoisted(() => vi.fn())
const deleteSubscriptionByEndpoint = vi.hoisted(() => vi.fn())
const setPreference = vi.hoisted(() => vi.fn())
const subscribeToPush = vi.hoisted(() => vi.fn())
const unsubscribeFromPush = vi.hoisted(() => vi.fn())
const getCurrentPushSubscription = vi.hoisted(() => vi.fn())

vi.mock('../queries/push-notifications.queries', () => ({
  WORKOUT_REMINDER_KIND: 'workout_reminder',
  pushNotificationsQueries: { getSubscriptionByEndpoint, getPreference, upsertSubscription, deleteSubscriptionByEndpoint, setPreference },
}))
vi.mock('../../features/notifications/push-subscription', () => ({ subscribeToPush, unsubscribeFromPush, getCurrentPushSubscription }))

import { pushNotificationsRepository } from './push-notifications.repository'

const USER_ID = 'user-1'
const LOCAL_SUBSCRIPTION = { endpoint: 'https://push.example/this-device', p256dh: 'p', authKey: 'a' }

describe('pushNotificationsRepository.status', () => {
  beforeEach(() => {
    getCurrentPushSubscription.mockReset()
    getSubscriptionByEndpoint.mockReset()
    getPreference.mockReset()
  })

  it('reports subscribed and enabled when this device has a local and a matching server subscription', async () => {
    getCurrentPushSubscription.mockResolvedValue(LOCAL_SUBSCRIPTION)
    getSubscriptionByEndpoint.mockResolvedValue({ data: { user_id: USER_ID }, error: null })
    getPreference.mockResolvedValue({ data: { enabled: true }, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status).toEqual({ subscribed: true, workoutReminderEnabled: true })
    expect(getSubscriptionByEndpoint).toHaveBeenCalledWith(USER_ID, LOCAL_SUBSCRIPTION.endpoint)
  })

  it('reports not subscribed when the browser has no local subscription, without querying the server', async () => {
    getCurrentPushSubscription.mockResolvedValue(null)
    getPreference.mockResolvedValue({ data: null, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status).toEqual({ subscribed: false, workoutReminderEnabled: true })
    expect(getSubscriptionByEndpoint).not.toHaveBeenCalled()
  })

  it('reports not subscribed when a local subscription exists but the server has no matching row', async () => {
    getCurrentPushSubscription.mockResolvedValue(LOCAL_SUBSCRIPTION)
    getSubscriptionByEndpoint.mockResolvedValue({ data: null, error: null })
    getPreference.mockResolvedValue({ data: null, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status.subscribed).toBe(false)
  })

  it('defaults workoutReminderEnabled to true when no preference row exists (opt-out model)', async () => {
    getCurrentPushSubscription.mockResolvedValue(null)
    getPreference.mockResolvedValue({ data: null, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status.workoutReminderEnabled).toBe(true)
  })

  it('respects an explicit opt-out', async () => {
    getCurrentPushSubscription.mockResolvedValue(LOCAL_SUBSCRIPTION)
    getSubscriptionByEndpoint.mockResolvedValue({ data: { user_id: USER_ID }, error: null })
    getPreference.mockResolvedValue({ data: { enabled: false }, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status.workoutReminderEnabled).toBe(false)
  })

  it('throws a repository error when the subscription lookup fails', async () => {
    getCurrentPushSubscription.mockResolvedValue(LOCAL_SUBSCRIPTION)
    getSubscriptionByEndpoint.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })
    getPreference.mockResolvedValue({ data: null, error: null })
    await expect(pushNotificationsRepository.status(USER_ID)).rejects.toThrow()
  })
})

describe('pushNotificationsRepository.enable', () => {
  beforeEach(() => {
    subscribeToPush.mockReset()
    upsertSubscription.mockReset()
    setPreference.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('throws when no VAPID public key is configured', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '')
    await expect(pushNotificationsRepository.enable(USER_ID)).rejects.toThrow('недоступны')
    expect(subscribeToPush).not.toHaveBeenCalled()
  })

  it('subscribes the browser, persists it, and turns the preference on', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'test-vapid-public-key')
    const subscription = { endpoint: 'https://push.example/ep1', p256dh: 'p256dh', authKey: 'auth' }
    subscribeToPush.mockResolvedValue(subscription)
    upsertSubscription.mockResolvedValue({ error: null })
    setPreference.mockResolvedValue({ error: null })

    await pushNotificationsRepository.enable(USER_ID)

    expect(upsertSubscription).toHaveBeenCalledWith(USER_ID, subscription)
    expect(setPreference).toHaveBeenCalledWith(USER_ID, 'workout_reminder', true)
  })

  it('propagates a repository error when persisting the subscription fails', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'test-vapid-public-key')
    subscribeToPush.mockResolvedValue({ endpoint: 'e', p256dh: 'p', authKey: 'a' })
    upsertSubscription.mockResolvedValue({ error: { code: '23505', message: 'duplicate' } })

    await expect(pushNotificationsRepository.enable(USER_ID)).rejects.toThrow()
    expect(setPreference).not.toHaveBeenCalled()
  })
})

describe('pushNotificationsRepository.disable', () => {
  beforeEach(() => {
    unsubscribeFromPush.mockReset()
    deleteSubscriptionByEndpoint.mockReset()
    setPreference.mockReset()
  })

  it('turns the preference off, unsubscribes this device, and removes only its row', async () => {
    setPreference.mockResolvedValue({ error: null })
    unsubscribeFromPush.mockResolvedValue({ endpoint: 'https://push.example/this-device' })
    deleteSubscriptionByEndpoint.mockResolvedValue({ error: null })

    await pushNotificationsRepository.disable(USER_ID)

    expect(setPreference).toHaveBeenCalledWith(USER_ID, 'workout_reminder', false)
    expect(unsubscribeFromPush).toHaveBeenCalled()
    expect(deleteSubscriptionByEndpoint).toHaveBeenCalledWith(USER_ID, 'https://push.example/this-device')
  })

  it('does not touch the server when this device had no active browser subscription to begin with', async () => {
    setPreference.mockResolvedValue({ error: null })
    unsubscribeFromPush.mockResolvedValue(null)

    await pushNotificationsRepository.disable(USER_ID)

    expect(deleteSubscriptionByEndpoint).not.toHaveBeenCalled()
  })
})
