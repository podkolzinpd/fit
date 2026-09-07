import { getCurrentPushSubscription, subscribeToPush, unsubscribeFromPush } from '../../features/notifications/push-subscription'
import { pushNotificationsQueries, WORKOUT_REMINDER_KIND } from '../queries/push-notifications.queries'
import { repositoryError } from './error'

export type NotificationStatus = {
  subscribed: boolean
  workoutReminderEnabled: boolean
}

export const pushNotificationsRepository = {
  async status(userId: string): Promise<NotificationStatus> {
    const local = await getCurrentPushSubscription()
    const [subscription, preference] = await Promise.all([
      local ? pushNotificationsQueries.getSubscriptionByEndpoint(userId, local.endpoint) : Promise.resolve({ data: null, error: null }),
      pushNotificationsQueries.getPreference(userId, WORKOUT_REMINDER_KIND),
    ])
    if (subscription.error) throw repositoryError(subscription.error)
    if (preference.error) throw repositoryError(preference.error)
    return {
      subscribed: local !== null && subscription.data !== null,
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
