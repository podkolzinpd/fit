import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => vi.fn())
const notifications = vi.hoisted(() => ({
  addListener: vi.fn(),
  cancel: vi.fn(),
  checkPermissions: vi.fn(),
  getDeliveredNotifications: vi.fn(),
  getPending: vi.fn(),
  registerActionTypes: vi.fn(),
  removeDeliveredNotifications: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native } }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: notifications }))

import {
  cancelAllNativeWorkoutInactivityReminders,
  cancelNativeWorkoutInactivityReminder,
  clearWorkoutInactivityReminder,
  consumeWorkoutInactivityAction,
  ensureWorkoutInactivityReminder,
  markWorkoutInactivityReminderNotified,
  readWorkoutInactivityReminder,
  recordWorkoutInactivityActivity,
  requestWorkoutInactivityNotificationPermission,
  scheduleNativeWorkoutInactivityReminder,
  showBrowserWorkoutInactivityReminder,
  workoutInactivityNotificationPermission,
  workoutInactivityNotificationId,
  WORKOUT_INACTIVITY_DELAY_MS,
} from './workout-inactivity-reminder'

const USER_ID = 'user-1'
const WORKOUT_ID = '82000000-0000-4000-8000-000000000001'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('workout inactivity reminder', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() })
    native.mockReset().mockReturnValue(false)
    for (const mock of Object.values(notifications)) mock.mockReset()
    notifications.getDeliveredNotifications.mockResolvedValue({ notifications: [] })
    Reflect.deleteProperty(navigator, 'serviceWorker')
    Reflect.deleteProperty(globalThis, 'Notification')
  })

  it('starts at twenty minutes and moves from the last meaningful activity', () => {
    const started = ensureWorkoutInactivityReminder(USER_ID, WORKOUT_ID, 1_000)
    expect(started.dueAt).toBe(1_000 + WORKOUT_INACTIVITY_DELAY_MS)

    const changed = recordWorkoutInactivityActivity(USER_ID, WORKOUT_ID, null, 61_000)
    expect(changed.dueAt).toBe(61_000 + WORKOUT_INACTIVITY_DELAY_MS)
    expect(readWorkoutInactivityReminder(USER_ID, WORKOUT_ID)).toEqual(changed)
  })

  it('starts a fresh twenty-minute window after an active rest timer ends', () => {
    const restEndsAt = 301_000
    const changed = recordWorkoutInactivityActivity(USER_ID, WORKOUT_ID, restEndsAt, 1_000)
    expect(changed.dueAt).toBe(restEndsAt + WORKOUT_INACTIVITY_DELAY_MS)
  })

  it('does not create repeating reminders after the first one was shown', () => {
    const initial = ensureWorkoutInactivityReminder(USER_ID, WORKOUT_ID, 1_000)
    const notified = markWorkoutInactivityReminderNotified(initial, 2_000)
    const later = recordWorkoutInactivityActivity(USER_ID, WORKOUT_ID, null, 9_999_000)
    expect(later).toEqual(notified)
  })

  it('uses a stable positive notification id and schedules one native reminder with actions', async () => {
    native.mockReturnValue(true)
    notifications.checkPermissions.mockResolvedValue({ display: 'granted' })
    notifications.registerActionTypes.mockResolvedValue(undefined)
    notifications.cancel.mockResolvedValue(undefined)
    notifications.schedule.mockResolvedValue({ notifications: [] })
    const state = ensureWorkoutInactivityReminder(USER_ID, WORKOUT_ID, 1_000)

    await expect(scheduleNativeWorkoutInactivityReminder(state)).resolves.toBe(true)
    const id = workoutInactivityNotificationId(WORKOUT_ID)
    expect(id).toBeGreaterThanOrEqual(0)
    expect(workoutInactivityNotificationId(WORKOUT_ID)).toBe(id)
    expect(notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id }] })
    expect(notifications.schedule).toHaveBeenCalledWith({ notifications: [expect.objectContaining({
      id,
      actionTypeId: 'fit-workout-inactivity',
      title: 'Тренировка ещё идёт',
      schedule: { at: new Date(state.dueAt), allowWhileIdle: true },
    })] })
  })

  it('keeps the workout usable when permission is unavailable and clears state on completion', async () => {
    native.mockReturnValue(true)
    notifications.checkPermissions.mockResolvedValue({ display: 'denied' })
    const state = ensureWorkoutInactivityReminder(USER_ID, WORKOUT_ID, 1_000)
    await expect(scheduleNativeWorkoutInactivityReminder(state)).resolves.toBe(false)

    clearWorkoutInactivityReminder(USER_ID, WORKOUT_ID)
    expect(readWorkoutInactivityReminder(USER_ID, WORKOUT_ID)).toBeNull()
    await vi.waitFor(() => expect(notifications.cancel).toHaveBeenCalled())
  })

  it('rejects corrupted or mismatched stored reminder data', () => {
    localStorage.setItem(`fit:workout-inactivity:${USER_ID}:${WORKOUT_ID}`, '{broken')
    expect(readWorkoutInactivityReminder(USER_ID, WORKOUT_ID)).toBeNull()
    localStorage.setItem(`fit:workout-inactivity:${USER_ID}:${WORKOUT_ID}`, JSON.stringify({
      version: 1, userId: 'someone-else', workoutId: WORKOUT_ID, dueAt: 1,
    }))
    expect(readWorkoutInactivityReminder(USER_ID, WORKOUT_ID)).toBeNull()
  })

  it('maps native permission states and safely handles bridge errors', async () => {
    await expect(workoutInactivityNotificationPermission()).resolves.toBe('unsupported')
    native.mockReturnValue(true)
    notifications.checkPermissions.mockResolvedValueOnce({ display: 'prompt-with-rationale' })
    await expect(workoutInactivityNotificationPermission()).resolves.toBe('prompt')
    notifications.checkPermissions.mockResolvedValueOnce({ display: 'denied' })
    await expect(workoutInactivityNotificationPermission()).resolves.toBe('denied')
    notifications.checkPermissions.mockRejectedValueOnce(new Error('bridge unavailable'))
    await expect(workoutInactivityNotificationPermission()).resolves.toBe('unsupported')
  })

  it('requests native permission and registers actions only when granted', async () => {
    await expect(requestWorkoutInactivityNotificationPermission()).resolves.toBe(false)
    native.mockReturnValue(true)
    notifications.requestPermissions.mockResolvedValueOnce({ display: 'denied' })
    await expect(requestWorkoutInactivityNotificationPermission()).resolves.toBe(false)
    notifications.requestPermissions.mockResolvedValueOnce({ display: 'granted' })
    notifications.registerActionTypes.mockResolvedValue(undefined)
    await expect(requestWorkoutInactivityNotificationPermission()).resolves.toBe(true)
    expect(notifications.registerActionTypes).toHaveBeenCalledWith({ types: [expect.objectContaining({ id: 'fit-workout-inactivity' })] })
  })

  it('cancels matching delivered reminders and all matching pending reminders', async () => {
    native.mockReturnValue(true)
    const id = workoutInactivityNotificationId(WORKOUT_ID)
    notifications.cancel.mockResolvedValue(undefined)
    notifications.getDeliveredNotifications.mockResolvedValue({ notifications: [{ id, title: 'Reminder', body: '' }, { id: id + 1, title: 'Other', body: '' }] })
    await cancelNativeWorkoutInactivityReminder(WORKOUT_ID)
    expect(notifications.removeDeliveredNotifications).toHaveBeenCalledWith({ notifications: [expect.objectContaining({ id })] })

    notifications.getPending.mockResolvedValue({ notifications: [
      { id, title: 'Reminder', body: '', extra: { type: 'workout-inactivity' } },
      { id: id + 1, title: 'Other', body: '', extra: { type: 'planned-workout' } },
    ] })
    await cancelAllNativeWorkoutInactivityReminders()
    expect(notifications.cancel).toHaveBeenLastCalledWith({ notifications: [{ id }] })
  })

  it('shows a browser reminder through the service worker only with permission', async () => {
    const state = ensureWorkoutInactivityReminder(USER_ID, WORKOUT_ID, 1_000)
    await expect(showBrowserWorkoutInactivityReminder(state)).resolves.toBe(false)

    const showNotification = vi.fn().mockResolvedValue(undefined)
    const register = vi.fn().mockResolvedValue({ showNotification })
    Object.defineProperty(globalThis, 'Notification', { configurable: true, value: { permission: 'granted' } })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    await expect(showBrowserWorkoutInactivityReminder(state)).resolves.toBe(true)
    expect(register).toHaveBeenCalledWith('/sw.js')
    expect(showNotification).toHaveBeenCalledWith('Тренировка ещё идёт', expect.objectContaining({
      tag: `fit-workout-inactivity-${WORKOUT_ID}`,
      actions: [{ action: 'continue', title: 'Продолжить' }, { action: 'finish', title: 'Завершить' }],
    }))
  })

  it('consumes only a valid pending action for the current workout', () => {
    localStorage.setItem('fit:workout-inactivity-action', JSON.stringify({ workoutId: 'other', action: 'finish' }))
    expect(consumeWorkoutInactivityAction(WORKOUT_ID)).toBeNull()
    localStorage.setItem('fit:workout-inactivity-action', JSON.stringify({ workoutId: WORKOUT_ID, action: 'finish' }))
    expect(consumeWorkoutInactivityAction(WORKOUT_ID)).toBe('finish')
    expect(consumeWorkoutInactivityAction(WORKOUT_ID)).toBeNull()
  })
})
