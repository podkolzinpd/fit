import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSubscription = vi.hoisted(() => vi.fn())
const getPreference = vi.hoisted(() => vi.fn())
const upsertSubscription = vi.hoisted(() => vi.fn())
const deleteSubscription = vi.hoisted(() => vi.fn())
const setPreference = vi.hoisted(() => vi.fn())
const subscribeToPush = vi.hoisted(() => vi.fn())
const unsubscribeFromPush = vi.hoisted(() => vi.fn())

vi.mock('../queries/push-notifications.queries', () => ({
  WORKOUT_REMINDER_KIND: 'workout_reminder',
  pushNotificationsQueries: { getSubscription, getPreference, upsertSubscription, deleteSubscription, setPreference },
}))
vi.mock('../../features/notifications/push-subscription', () => ({ subscribeToPush, unsubscribeFromPush }))

import { pushNotificationsRepository } from './push-notifications.repository'

const USER_ID = 'user-1'

describe('pushNotificationsRepository.status', () => {
  beforeEach(() => {
    getSubscription.mockReset()
    getPreference.mockReset()
  })

  it('reports subscribed and enabled when both exist', async () => {
    getSubscription.mockResolvedValue({ data: { user_id: USER_ID }, error: null })
    getPreference.mockResolvedValue({ data: { enabled: true }, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status).toEqual({ subscribed: true, workoutReminderEnabled: true })
  })

  it('defaults workoutReminderEnabled to true when no preference row exists (opt-out model)', async () => {
    getSubscription.mockResolvedValue({ data: null, error: null })
    getPreference.mockResolvedValue({ data: null, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status).toEqual({ subscribed: false, workoutReminderEnabled: true })
  })

  it('respects an explicit opt-out', async () => {
    getSubscription.mockResolvedValue({ data: { user_id: USER_ID }, error: null })
    getPreference.mockResolvedValue({ data: { enabled: false }, error: null })
    const status = await pushNotificationsRepository.status(USER_ID)
    expect(status.workoutReminderEnabled).toBe(false)
  })

  it('throws a repository error when the subscription lookup fails', async () => {
    getSubscription.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })
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
    deleteSubscription.mockReset()
    setPreference.mockReset()
  })

  it('turns the preference off, unsubscribes the browser, and removes the row', async () => {
    setPreference.mockResolvedValue({ error: null })
    deleteSubscription.mockResolvedValue({ error: null })

    await pushNotificationsRepository.disable(USER_ID)

    expect(setPreference).toHaveBeenCalledWith(USER_ID, 'workout_reminder', false)
    expect(unsubscribeFromPush).toHaveBeenCalled()
    expect(deleteSubscription).toHaveBeenCalledWith(USER_ID)
  })
})
