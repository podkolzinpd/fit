import type { BrowserPushSubscription } from '../../features/notifications/push-subscription'
import { supabase } from './client'

export const WORKOUT_REMINDER_KIND = 'workout_reminder'

export const pushNotificationsQueries = {
  upsertSubscription: (userId: string, subscription: BrowserPushSubscription) => supabase
    .from('push_subscriptions')
    .upsert({ user_id: userId, endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth_key: subscription.authKey }, { onConflict: 'user_id' }),
  deleteSubscription: (userId: string) => supabase.from('push_subscriptions').delete().eq('user_id', userId),
  getSubscription: (userId: string) => supabase.from('push_subscriptions').select('user_id').eq('user_id', userId).maybeSingle(),
  getPreference: (userId: string, kind: string) => supabase
    .from('notification_preferences')
    .select('enabled')
    .eq('user_id', userId)
    .eq('kind', kind)
    .maybeSingle(),
  setPreference: (userId: string, kind: string, enabled: boolean) => supabase
    .from('notification_preferences')
    .upsert({ user_id: userId, kind, enabled }, { onConflict: 'user_id,kind' }),
}
