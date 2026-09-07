import { reconcilePushSubscription, type PushSubscriptionState } from '../../features/notifications/reconcile-push-subscription'
import { subscribeToPush, unsubscribeFromPush } from '../../features/notifications/push-subscription'
import { pushNotificationsQueries, WORKOUT_REMINDER_KIND } from '../queries/push-notifications.queries'
import { repositoryError } from './error'

export type NotificationStatus = {
  state: PushSubscriptionState
  workoutReminderEnabled: boolean
}

export const pushNotificationsRepository = {
  async status(userId: string): Promise<NotificationStatus> {
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
    const [state, preference] = await Promise.all([
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
    ])
    if (preference.error) throw repositoryError(preference.error)
    return {
      state,
      // Реестр видов уведомлений — opt-out: строки нет, пока пользователь не
      // выключил конкретный вид явно, поэтому отсутствие строки = включено.
      workoutReminderEnabled: preference.data?.enabled ?? true,
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
