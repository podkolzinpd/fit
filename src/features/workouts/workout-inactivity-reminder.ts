import { Capacitor } from '@capacitor/core'
import { LocalNotifications, type ActionPerformed } from '@capacitor/local-notifications'

export const WORKOUT_INACTIVITY_DELAY_MS = 20 * 60 * 1_000
export const WORKOUT_INACTIVITY_ACTION_TYPE = 'fit-workout-inactivity'
export const WORKOUT_INACTIVITY_CONTINUE_ACTION = 'continue'
export const WORKOUT_INACTIVITY_FINISH_ACTION = 'finish'
export const WORKOUT_INACTIVITY_NOTIFICATION_TYPE = 'workout-inactivity'

const REMINDER_STORAGE_PREFIX = 'fit:workout-inactivity:'
const PENDING_ACTION_STORAGE_KEY = 'fit:workout-inactivity-action'

export type WorkoutInactivityReminderState = {
  version: 1
  userId: string
  workoutId: string
  dueAt: number
  notifiedAt?: number
}

export type WorkoutInactivityAction = {
  workoutId: string
  action: 'continue' | 'finish'
}

function storageKey(userId: string, workoutId: string) {
  return `${REMINDER_STORAGE_PREFIX}${userId}:${workoutId}`
}

function validState(value: unknown): value is WorkoutInactivityReminderState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Partial<WorkoutInactivityReminderState>
  return state.version === 1
    && typeof state.userId === 'string'
    && typeof state.workoutId === 'string'
    && Number.isFinite(state.dueAt)
    && (state.notifiedAt === undefined || Number.isFinite(state.notifiedAt))
}

export function readWorkoutInactivityReminder(userId: string, workoutId: string): WorkoutInactivityReminderState | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(userId, workoutId)) ?? 'null')
    if (!validState(parsed) || parsed.userId !== userId || parsed.workoutId !== workoutId) return null
    return parsed
  } catch {
    return null
  }
}

function writeWorkoutInactivityReminder(state: WorkoutInactivityReminderState) {
  try { localStorage.setItem(storageKey(state.userId, state.workoutId), JSON.stringify(state)) } catch { /* The live workout remains usable without storage. */ }
  window.dispatchEvent(new CustomEvent('fit-workout-inactivity-state', { detail: state }))
  return state
}

export function ensureWorkoutInactivityReminder(
  userId: string,
  workoutId: string,
  now = Date.now(),
): WorkoutInactivityReminderState {
  return readWorkoutInactivityReminder(userId, workoutId)
    ?? writeWorkoutInactivityReminder({ version: 1, userId, workoutId, dueAt: now + WORKOUT_INACTIVITY_DELAY_MS })
}

export function recordWorkoutInactivityActivity(
  userId: string,
  workoutId: string,
  activeUntil: number | null = null,
  now = Date.now(),
): WorkoutInactivityReminderState {
  const current = readWorkoutInactivityReminder(userId, workoutId)
  // One reminder per workout: ordinary activity after it was displayed must
  // not create a new notification every twenty minutes.
  if (current?.notifiedAt !== undefined) return current
  return writeWorkoutInactivityReminder({
    version: 1,
    userId,
    workoutId,
    dueAt: Math.max(now, activeUntil ?? 0) + WORKOUT_INACTIVITY_DELAY_MS,
  })
}

export function markWorkoutInactivityReminderNotified(
  state: WorkoutInactivityReminderState,
  now = Date.now(),
) {
  return writeWorkoutInactivityReminder({ ...state, notifiedAt: state.notifiedAt ?? now })
}

export function workoutInactivityNotificationId(workoutId: string): number {
  // Stable positive 31-bit FNV-1a hash: Capacitor requires an integer ID and
  // the same ID lets each activity replace the previous pending reminder.
  let hash = 0x811c9dc5
  for (const character of workoutId) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash & 0x7fffffff
}

export function isNativeWorkoutInactivityReminderSupported() {
  return Capacitor.isNativePlatform()
}

async function registerNativeActionType() {
  await LocalNotifications.registerActionTypes({
    types: [{
      id: WORKOUT_INACTIVITY_ACTION_TYPE,
      actions: [
        { id: WORKOUT_INACTIVITY_CONTINUE_ACTION, title: 'Продолжить', foreground: true },
        { id: WORKOUT_INACTIVITY_FINISH_ACTION, title: 'Завершить', foreground: true },
      ],
    }],
  })
}

export async function workoutInactivityNotificationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  if (!isNativeWorkoutInactivityReminderSupported()) return 'unsupported'
  try {
    const { display } = await LocalNotifications.checkPermissions()
    if (display === 'granted' || display === 'denied' || display === 'prompt') return display
    return display === 'prompt-with-rationale' ? 'prompt' : 'denied'
  } catch {
    return 'unsupported'
  }
}

export async function requestWorkoutInactivityNotificationPermission(): Promise<boolean> {
  if (!isNativeWorkoutInactivityReminderSupported()) return false
  try {
    const { display } = await LocalNotifications.requestPermissions()
    if (display !== 'granted') return false
    await registerNativeActionType()
    return true
  } catch {
    return false
  }
}

export async function scheduleNativeWorkoutInactivityReminder(state: WorkoutInactivityReminderState): Promise<boolean> {
  if (state.notifiedAt !== undefined || !isNativeWorkoutInactivityReminderSupported()) return false
  try {
    const permission = await LocalNotifications.checkPermissions()
    if (permission.display !== 'granted') return false
    await registerNativeActionType()
    const id = workoutInactivityNotificationId(state.workoutId)
    await LocalNotifications.cancel({ notifications: [{ id }] })
    await LocalNotifications.schedule({
      notifications: [{
        id,
        title: 'Тренировка ещё идёт',
        body: 'Продолжить или завершить её?',
        schedule: { at: new Date(state.dueAt), allowWhileIdle: true },
        actionTypeId: WORKOUT_INACTIVITY_ACTION_TYPE,
        extra: {
          type: WORKOUT_INACTIVITY_NOTIFICATION_TYPE,
          userId: state.userId,
          workoutId: state.workoutId,
        },
        // The foreground live screen has its own inline reminder. In the
        // background iOS still presents this notification normally.
        silent: true,
      }],
    })
    return true
  } catch {
    return false
  }
}

export async function cancelNativeWorkoutInactivityReminder(workoutId: string) {
  if (!isNativeWorkoutInactivityReminderSupported()) return
  try {
    const id = workoutInactivityNotificationId(workoutId)
    await LocalNotifications.cancel({ notifications: [{ id }] })
    const delivered = await LocalNotifications.getDeliveredNotifications()
    const matching = delivered.notifications.filter((notification) => notification.id === id)
    if (matching.length > 0) await LocalNotifications.removeDeliveredNotifications({ notifications: matching })
  } catch {
    // A reminder must never block completing or cancelling a workout.
  }
}

export async function cancelAllNativeWorkoutInactivityReminders() {
  if (!isNativeWorkoutInactivityReminderSupported()) return
  try {
    const pending = await LocalNotifications.getPending()
    const reminders = pending.notifications
      .filter((notification) => (notification.extra as Record<string, unknown> | undefined)?.type === WORKOUT_INACTIVITY_NOTIFICATION_TYPE)
      .map(({ id }) => ({ id }))
    if (reminders.length > 0) await LocalNotifications.cancel({ notifications: reminders })
  } catch {
    // Preference updates remain valid even if the native bridge is unavailable.
  }
}

export function clearWorkoutInactivityReminder(userId: string, workoutId: string) {
  try { localStorage.removeItem(storageKey(userId, workoutId)) } catch { /* no-op */ }
  void cancelNativeWorkoutInactivityReminder(workoutId)
}

export async function showBrowserWorkoutInactivityReminder(state: WorkoutInactivityReminderState): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return false
  try {
    const registration = await navigator.serviceWorker.register('/sw.js')
    const options: NotificationOptions & { actions: Array<{ action: string; title: string }> } = {
      body: 'Продолжить или завершить её?',
      tag: `fit-workout-inactivity-${state.workoutId}`,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: {
        type: WORKOUT_INACTIVITY_NOTIFICATION_TYPE,
        workout_id: state.workoutId,
        url: `/workouts/${state.workoutId}/live`,
      },
      actions: [
        { action: WORKOUT_INACTIVITY_CONTINUE_ACTION, title: 'Продолжить' },
        { action: WORKOUT_INACTIVITY_FINISH_ACTION, title: 'Завершить' },
      ],
    }
    await registration.showNotification('Тренировка ещё идёт', options)
    return true
  } catch {
    return false
  }
}

function savePendingAction(action: WorkoutInactivityAction) {
  try { localStorage.setItem(PENDING_ACTION_STORAGE_KEY, JSON.stringify(action)) } catch { /* no-op */ }
}

function actionFromNotification(notificationAction: ActionPerformed): WorkoutInactivityAction | null {
  const extra = notificationAction.notification.extra as Record<string, unknown> | undefined
  if (extra?.type !== WORKOUT_INACTIVITY_NOTIFICATION_TYPE || typeof extra.workoutId !== 'string') return null
  return {
    workoutId: extra.workoutId,
    action: notificationAction.actionId === WORKOUT_INACTIVITY_FINISH_ACTION ? 'finish' : 'continue',
  }
}

export function consumeWorkoutInactivityAction(workoutId: string): WorkoutInactivityAction['action'] | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_ACTION_STORAGE_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const action = parsed as Partial<WorkoutInactivityAction>
    if (action.workoutId !== workoutId || (action.action !== 'continue' && action.action !== 'finish')) return null
    localStorage.removeItem(PENDING_ACTION_STORAGE_KEY)
    return action.action
  } catch {
    return null
  }
}

export function initializeWorkoutInactivityNotificationActions() {
  if (!isNativeWorkoutInactivityReminderSupported()) return
  void registerNativeActionType().catch(() => undefined)
  void LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
    const action = actionFromNotification(notificationAction)
    if (!action) return
    const extra = notificationAction.notification.extra as Record<string, unknown> | undefined
    if (typeof extra?.userId === 'string') {
      const state = readWorkoutInactivityReminder(extra.userId, action.workoutId)
      if (state) markWorkoutInactivityReminderNotified(state)
    }
    savePendingAction(action)
    window.location.assign(`/workouts/${action.workoutId}/live${action.action === 'finish' ? '?reminder=finish' : ''}`)
  }).catch(() => undefined)
  void LocalNotifications.addListener('localNotificationReceived', (notification) => {
    const extra = notification.extra as Record<string, unknown> | undefined
    if (extra?.type !== WORKOUT_INACTIVITY_NOTIFICATION_TYPE
      || typeof extra.userId !== 'string'
      || typeof extra.workoutId !== 'string') return
    const state = readWorkoutInactivityReminder(extra.userId, extra.workoutId)
    if (state) markWorkoutInactivityReminderNotified(state)
  }).catch(() => undefined)
}
