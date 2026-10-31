import type { PushSubscriptionState } from '../../features/notifications/reconcile-push-subscription'

export type NotificationStatus = {
  state: PushSubscriptionState
  workoutReminderEnabled: boolean
  workoutScheduledEnabled: boolean
  chatMessageEnabled: boolean
}
