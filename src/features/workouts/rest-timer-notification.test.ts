import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => vi.fn())
const notifications = vi.hoisted(() => ({
  cancel: vi.fn(),
  checkPermissions: vi.fn(),
  getDeliveredNotifications: vi.fn(),
  removeDeliveredNotifications: vi.fn(),
  schedule: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native } }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: notifications }))

import {
  cancelNativeRestTimerNotification,
  restTimerNotificationId,
  scheduleNativeRestTimerNotification,
  wasNativeRestTimerNotificationScheduled,
} from './rest-timer-notification'
import { workoutInactivityNotificationId } from './workout-inactivity-reminder'

const WORKOUT_ID = '82000000-0000-4000-8000-000000000001'

describe('native rest timer notification', () => {
  beforeEach(() => {
    sessionStorage.clear()
    native.mockReset().mockReturnValue(false)
    for (const mock of Object.values(notifications)) mock.mockReset()
    notifications.cancel.mockResolvedValue(undefined)
    notifications.getDeliveredNotifications.mockResolvedValue({ notifications: [] })
    notifications.removeDeliveredNotifications.mockResolvedValue(undefined)
    notifications.schedule.mockResolvedValue({ notifications: [] })
  })

  it('schedules the local gong only on native with an existing permission', async () => {
    const deadline = 200_000
    await expect(scheduleNativeRestTimerNotification(WORKOUT_ID, deadline)).resolves.toBe(false)

    native.mockReturnValue(true)
    notifications.checkPermissions.mockResolvedValueOnce({ display: 'denied' })
    await expect(scheduleNativeRestTimerNotification(WORKOUT_ID, deadline)).resolves.toBe(false)

    notifications.checkPermissions.mockResolvedValueOnce({ display: 'granted' })
    await expect(scheduleNativeRestTimerNotification(WORKOUT_ID, deadline)).resolves.toBe(true)
    expect(notifications.schedule).toHaveBeenCalledWith({ notifications: [expect.objectContaining({
      id: restTimerNotificationId(WORKOUT_ID),
      title: 'Время отдыха истекло',
      schedule: { at: new Date(deadline), allowWhileIdle: true },
      sound: 'rest-gong.wav',
      foreground: false,
    })] })
    expect(wasNativeRestTimerNotificationScheduled(WORKOUT_ID, deadline)).toBe(true)
  })

  it('cancels pending and delivered signals and clears the background marker', async () => {
    native.mockReturnValue(true)
    notifications.checkPermissions.mockResolvedValue({ display: 'granted' })
    await scheduleNativeRestTimerNotification(WORKOUT_ID, 200_000)
    const id = restTimerNotificationId(WORKOUT_ID)
    notifications.getDeliveredNotifications.mockResolvedValue({ notifications: [{ id, title: 'Время отдыха истекло', body: '' }] })

    await cancelNativeRestTimerNotification(WORKOUT_ID)
    expect(notifications.cancel).toHaveBeenLastCalledWith({ notifications: [{ id }] })
    expect(notifications.removeDeliveredNotifications).toHaveBeenCalledWith({ notifications: [expect.objectContaining({ id })] })
    expect(wasNativeRestTimerNotificationScheduled(WORKOUT_ID, 200_000)).toBe(false)
  })

  it('uses a stable positive id distinct from the workout reminder namespace', () => {
    expect(restTimerNotificationId(WORKOUT_ID)).toBe(restTimerNotificationId(WORKOUT_ID))
    expect(restTimerNotificationId(WORKOUT_ID)).toBeGreaterThanOrEqual(0)
    expect(restTimerNotificationId(WORKOUT_ID)).not.toBe(workoutInactivityNotificationId(WORKOUT_ID))
  })
})
