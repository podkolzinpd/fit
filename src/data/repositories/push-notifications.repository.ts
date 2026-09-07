import { reconcilePushSubscription, type PushSubscriptionState } from '../../features/notifications/reconcile-push-subscription'
import { subscribeToPush, unsubscribeFromPush } from '../../features/notifications/push-subscription'
import { pushNotificationsQueries, WORKOUT_REMINDER_KIND, WORKOUT_SCHEDULED_KIND } from '../queries/push-notifications.queries'
import { repositoryError } from './error'

// UI не может импортировать queries напрямую (no-restricted-imports) — эти
// значения kind ей всё равно нужны как параметры setCategoryEnabled(userId, kind, enabled).
export { WORKOUT_REMINDER_KIND, WORKOUT_SCHEDULED_KIND }

export type NotificationStatus = {
  state: PushSubscriptionState
  workoutReminderEnabled: boolean
  workoutScheduledEnabled: boolean
}

export const pushNotificationsRepository = {
  async status(userId: string): Promise<NotificationStatus> {
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
    const [state, reminderPreference, scheduledPreference] = await Promise.all([
      reconcilePushSubscription(vapidPublicKey, {
        hasServerSubscription: async (endpoint) => {
          const result = await pushNotificationsQueries.getSubscriptionByEndpoint(userId, endpoint)
          if (result.error) throw repositoryError(result.error)
          return result.data !== null
        },
        saveSubscription: async (subscription) => {
          const result = await pushNotificationsQueries.upsertSubscription(userId, subscription)
          if (result.error) throw repositoryError(result.error)
        },
      }),
      pushNotificationsQueries.getPreference(userId, WORKOUT_REMINDER_KIND),
      pushNotificationsQueries.getPreference(userId, WORKOUT_SCHEDULED_KIND),
    ])
    if (reminderPreference.error) throw repositoryError(reminderPreference.error)
    if (scheduledPreference.error) throw repositoryError(scheduledPreference.error)
    return {
      state,
      // Реестр видов уведомлений — opt-out: строки нет, пока пользователь не
      // выключил конкретный вид явно, поэтому отсутствие строки = включено.
      workoutReminderEnabled: reminderPreference.data?.enabled ?? true,
      workoutScheduledEnabled: scheduledPreference.data?.enabled ?? true,
    }
  },

  async enable(userId: string): Promise<void> {
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
    if (!vapidPublicKey) throw new Error('Push-уведомления сейчас недоступны')
    const subscription = await subscribeToPush(vapidPublicKey)
    const result = await pushNotificationsQueries.upsertSubscription(userId, subscription)
    if (result.error) throw repositoryError(result.error)
    const preference = await pushNotificationsQueries.setPreference(userId, WORKOUT_REMINDER_KIND, true)
    if (preference.error) throw repositoryError(preference.error)
  },

  // Отдельно от enable() (который всегда включает и подписку, и
  // workout_reminder разом) — категорийные тумблеры в профиле переключают
  // ровно один вид уведомлений, не трогая подписку устройства.
  async setCategoryEnabled(userId: string, kind: string, enabled: boolean): Promise<void> {
    const preference = await pushNotificationsQueries.setPreference(userId, kind, enabled)
    if (preference.error) throw repositoryError(preference.error)
  },

  async sendTestPush(endpoint: string): Promise<void> {
    const result = await pushNotificationsQueries.sendTestPush(endpoint)
    if (result.error) throw repositoryError(result.error)
  },

  async disable(userId: string): Promise<void> {
    const preference = await pushNotificationsQueries.setPreference(userId, WORKOUT_REMINDER_KIND, false)
    if (preference.error) throw repositoryError(preference.error)
    // Снять именно ЭТУ подписку браузера, пока объект ещё жив (endpoint
    // нужен, чтобы удалить ровно её строку) — отписка удаляет подписку
    // только текущего устройства, а не все устройства пользователя.
    const unsubscribed = await unsubscribeFromPush()
    if (!unsubscribed) return
    const result = await pushNotificationsQueries.deleteSubscriptionByEndpoint(userId, unsubscribed.endpoint)
    if (result.error) throw repositoryError(result.error)
  },
}
