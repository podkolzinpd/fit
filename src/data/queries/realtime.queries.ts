import { supabase } from './client'

export type ClientRealtimeTable =
  | 'clients'
  | 'workouts'
  | 'workout_exercises'
  | 'workout_sets'
  | 'client_progress'
  | 'client_progress_custom'
  | 'client_custom_metrics'

export interface ClientRealtimeChange {
  table: ClientRealtimeTable
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

export function subscribeToClientChanges(clientId: string, onChange: (change: ClientRealtimeChange) => void) {
  const channel = supabase.channel(`client:${clientId}`)
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'clients', filter: `id=eq.${clientId}` }, (payload) => {
    onChange({ table: 'clients', eventType: payload.eventType, new: payload.new, old: payload.old })
  })
  for (const table of ['workouts', 'workout_exercises', 'workout_sets', 'client_progress', 'client_progress_custom', 'client_custom_metrics'] as const) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `client_id=eq.${clientId}` }, (payload) => {
      onChange({ table, eventType: payload.eventType, new: payload.new, old: payload.old })
    })
  }
  channel.subscribe()
  return () => { void supabase.removeChannel(channel) }
}
