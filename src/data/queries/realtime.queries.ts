import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import { supabase } from './client'

export const clientRealtimeTables = [
  'clients',
  'workouts',
  'workout_exercises',
  'workout_sets',
  'client_progress',
  'client_progress_custom',
  'client_custom_metrics',
  'client_goals',
  'goal_stages',
  'client_trainers',
  'client_invitations',
  'client_training_summaries',
  'client_published_training_summaries',
] as const

export type ClientRealtimeTable = (typeof clientRealtimeTables)[number]

export interface ClientRealtimeChange {
  table: ClientRealtimeTable
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

export function subscribeToClientChanges(
  clientId: string,
  onChange: (change: ClientRealtimeChange) => void,
  onReady?: () => void,
) {
  const channel = supabase.channel(`client:${clientId}`)
  for (const table of clientRealtimeTables) {
    const filter = table === 'clients' ? `id=eq.${clientId}` : `client_id=eq.${clientId}`
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, (payload) => {
      onChange({
        table,
        eventType: payload.eventType,
        new: payload.new,
        old: payload.old,
      })
    })
  }
  channel.subscribe((status) => {
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) onReady?.()
  })
  return () => { void supabase.removeChannel(channel) }
}
