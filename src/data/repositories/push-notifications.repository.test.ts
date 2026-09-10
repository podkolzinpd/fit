import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSubscriptionByEndpoint = vi.hoisted(() => vi.fn())
const getPreference = vi.hoisted(() => vi.fn())
const upsertSubscription = vi.hoisted(() => vi.fn())
const deleteSubscriptionByEndpoint = vi.hoisted(() => vi.fn())
const setPreference = vi.hoisted(() => vi.fn())
const subscribeToPush = vi.hoisted(() => vi.fn())
const unsubscribeFromPush = vi.hoisted(() => vi.fn())
const getCurrentPushSubscription = vi.hoisted(() => vi.fn())
const isPushSupported = vi.hoisted(() => vi.fn())

vi.mock('../queries/push-notifications.queries', () => ({
  CHAT_MESSAGE_KIND: 'chat_message',
  WORKOUT_REMINDER_KIND: 'workout_reminder',
  WORKOUT_SCHEDULED_KIND: 'workout_scheduled',
  pushNotificationsQueries: { getSubscriptionByEndpoint, getPreference, upsertSubscription, deleteSubscriptionByEndpoint, setPreference },
}))
vi.mock('../../features/notifications/push-subscription', () => ({ subscribeToPush, unsubscribeFromPush, getCurrentPushSubscription, isPushSupported }))

import { pushNotificationsRepository } from './push-notifications.repository'

const USER_ID = 'user-1'
const LOCAL_SUBSCRIPTION = { endpoint: 'https://push.example/this-device', p256dh: 'p', authKey: 'a' }

// status() delegates the permission/local/server sync itself to
// reconcilePushSubscription (unit-tested on its own in
// reconcile-push-subscription.test.ts) — these tests only check that
// status() wires the Supabase queries into that reconciliation correctly and
// shapes the final { state, workoutReminderEnabled } result.
describe('pushNotificationsRepository.status', () => {
  beforeEach(() => {
    isPushSupported.mockReturnValue(true)
    vi.stubGlobal('Notification', { permission: 'granted' })
    getCurrentPushSubscription.mockReset()
    getSubscriptionByEndpoint.mockReset()
    getPreference.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reports a working state when this device has a local and a matching server subscription', async () => {
    getCurrentPushSubscription.mockResolvedValue(LOCAL_SUBSCRIPTION)
    getSubscriptionByEndpoint.mockResolvedValue({ data: { user_id: USER_ID }, error: null })
    getPreference.mockResolvedValue({ data: { enabled: true }, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status).toEqual({ state: 'working', workoutReminderEnabled: true, workoutScheduledEnabled: true, chatMessageEnabled: true })
    expect(getSubscriptionByEndpoint).toHaveBeenCalledWith(USER_ID, LOCAL_SUBSCRIPTION.endpoint)
  })

  it('fetches the preference for each category independently', async () => {
    getCurrentPushSubscription.mockResolvedValue(null)
    getPreference.mockImplementation((_userId: string, kind: string) => Promise.resolve({
      data: { enabled: kind === 'workout_reminder' },
      error: null,
    }))
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(getPreference).toHaveBeenCalledWith(USER_ID, 'workout_reminder')
    expect(getPreference).toHaveBeenCalledWith(USER_ID, 'workout_scheduled')
    expect(getPreference).toHaveBeenCalledWith(USER_ID, 'chat_message')
    expect(status.workoutReminderEnabled).toBe(true)
    expect(status.workoutScheduledEnabled).toBe(false)
  })

  it('reports needs-permission when the browser has not decided yet', async () => {
    vi.stubGlobal('Notification', { permission: 'default' })
    getPreference.mockResolvedValue({ data: null, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status).toEqual({ state: 'needs-permission', workoutReminderEnabled: true, workoutScheduledEnabled: true, chatMessageEnabled: true })
    expect(getCurrentPushSubscription).not.toHaveBeenCalled()
  })

  it('reports denied when the browser permission was explicitly revoked', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    getPreference.mockResolvedValue({ data: null, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status.state).toBe('denied')
  })

  it('defaults both category preferences to true when no rows exist (opt-out model)', async () => {
    vi.stubGlobal('Notification', { permission: 'default' })
    getPreference.mockResolvedValue({ data: null, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status.workoutReminderEnabled).toBe(true)
    expect(status.workoutScheduledEnabled).toBe(true)
    expect(status.chatMessageEnabled).toBe(true)
  })

  it('respects an explicit opt-out', async () => {
    getCurrentPushSubscription.mockResolvedValue(LOCAL_SUBSCRIPTION)
    getSubscriptionByEndpoint.mockResolvedValue({ data: { user_id: USER_ID }, error: null })
    getPreference.mockResolvedValue({ data: { enabled: false }, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status.workoutReminderEnabled).toBe(false)
    expect(status.workoutScheduledEnabled).toBe(false)
    expect(status.chatMessageEnabled).toBe(false)
  })

  it('throws a repository error when the subscription lookup fails', async () => {
    getCurrentPushSubscription.mockResolvedValue(LOCAL_SUBSCRIPTION)
    getSubscriptionByEndpoint.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })
    getPreference.mockResolvedValue({ data: null, error: null })
    await expect(pushNotificationsRepository.status(USER_ID)).rejects.toThrow()
  })
})

describe('pushNotificationsRepository.setCategoryEnabled', () => {
  beforeEach(() => setPreference.mockReset())

  it('sets the given category preference without touching the subscription', async () => {
    setPreference.mockResolvedValue({ error: null })
    await pushNotificationsRepository.setCategoryEnabled(USER_ID, 'workout_scheduled', false)
    expect(setPreference).toHaveBeenCalledWith(USER_ID, 'workout_scheduled', false)
    expect(subscribeToPush).not.toHaveBeenCalled()
    expect(unsubscribeFromPush).not.toHaveBeenCalled()
  })

  it('propagates a repository error', async () => {
    setPreference.mockResolvedValue({ error: { code: '42501', message: 'denied' } })
    await expect(pushNotificationsRepository.setCategoryEnabled(USER_ID, 'workout_reminder', true)).rejects.toThrow()
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
