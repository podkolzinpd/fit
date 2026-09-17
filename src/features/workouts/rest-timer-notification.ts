import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

export const REST_TIMER_NOTIFICATION_TYPE = 'rest-timer'

const NATIVE_MARKER_PREFIX = 'fit:live-rest-native:'

function nativeMarkerKey(workoutId: string) {
  return `${NATIVE_MARKER_PREFIX}${workoutId}`
}

function writeNativeMarker(workoutId: string, deadline: number | null) {
  try {
    if (deadline === null) sessionStorage.removeItem(nativeMarkerKey(workoutId))
    else sessionStorage.setItem(nativeMarkerKey(workoutId), String(deadline))
  } catch { /* The foreground timer remains usable without storage. */ }
}

export function wasNativeRestTimerNotificationScheduled(workoutId: string, deadline: number) {
  try { return Number(sessionStorage.getItem(nativeMarkerKey(workoutId))) === deadline } catch { return false }
}

export function restTimerNotificationId(workoutId: string): number {
  let hash = 0x811c9dc5
  for (const character of `rest:${workoutId}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash & 0x7fffffff
}

async function removeNativeRestTimerNotification(workoutId: string) {
  const id = restTimerNotificationId(workoutId)
  await LocalNotifications.cancel({ notifications: [{ id }] })
  const delivered = await LocalNotifications.getDeliveredNotifications()
  const matching = delivered.notifications.filter((notification) => notification.id === id)
  if (matching.length > 0) await LocalNotifications.removeDeliveredNotifications({ notifications: matching })
}

export async function scheduleNativeRestTimerNotification(workoutId: string, deadline: number): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const permission = await LocalNotifications.checkPermissions()
    if (permission.display !== 'granted') return false
    await removeNativeRestTimerNotification(workoutId)
    await LocalNotifications.schedule({
      notifications: [{
        id: restTimerNotificationId(workoutId),
        title: 'Время отдыха истекло',
        body: 'Можно переходить к следующему подходу.',
        schedule: { at: new Date(deadline), allowWhileIdle: true },
        sound: 'rest-gong.wav',
        foreground: false,
        extra: { type: REST_TIMER_NOTIFICATION_TYPE, workoutId, deadline },
      }],
    })
    writeNativeMarker(workoutId, deadline)
    return true
  } catch {
    writeNativeMarker(workoutId, null)
    return false
  }
}

export async function cancelNativeRestTimerNotification(workoutId: string) {
  writeNativeMarker(workoutId, null)
  if (!Capacitor.isNativePlatform()) return
  try { await removeNativeRestTimerNotification(workoutId) } catch { /* Rest controls must never fail because of the native bridge. */ }
}
