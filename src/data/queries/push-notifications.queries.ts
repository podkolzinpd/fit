import type { BrowserPushSubscription } from '../../features/notifications/push-subscription'
import { supabase } from './client'

export const WORKOUT_REMINDER_KIND = 'workout_reminder'
// kind существует в БД с 20260830140000 (push_workout_scheduled_notification),
// но клиент его не называл — не было UI-ручки для этой категории.
export const WORKOUT_SCHEDULED_KIND = 'workout_scheduled'
export const CHAT_MESSAGE_KIND = 'chat_message'

export const pushNotificationsQueries = {
  upsertSubscription: (userId: string, subscription: BrowserPushSubscription) => supabase
    .from('push_subscriptions')
    .upsert({ user_id: userId, endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth_key: subscription.authKey }, { onConflict: 'user_id,endpoint' }),
  // Устройство определяется парой (user_id, endpoint) — у пользователя может
  // быть несколько активных подписок одновременно, поэтому только
  // device-scoped операции: удалять/проверять «все подписки пользователя»
  // одним вызовом нельзя, иначе легко случайно погасить чужое устройство.
  deleteSubscriptionByEndpoint: (userId: string, endpoint: string) => supabase
    .from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint),
  getSubscriptionByEndpoint: (userId: string, endpoint: string) => supabase
    .from('push_subscriptions').select('user_id').eq('user_id', userId).eq('endpoint', endpoint).maybeSingle(),
  getPreference: (userId: string, kind: string) => supabase
    .from('notification_preferences')
    .select('enabled')
    .eq('user_id', userId)
    .eq('kind', kind)
    .maybeSingle(),
  setPreference: (userId: string, kind: string, enabled: boolean) => supabase
    .from('notification_preferences')
    .upsert({ user_id: userId, kind, enabled }, { onConflict: 'user_id,kind' }),
  sendTestPush: (endpoint: string) => supabase.rpc('send_test_push_notification', { p_endpoint: endpoint }),
}
