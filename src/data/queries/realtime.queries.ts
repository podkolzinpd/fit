import { supabase } from './client'

export function subscribeToClientChanges(clientId: string, onChange: () => void) {
  const channel = supabase.channel(`client:${clientId}`)
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'clients', filter: `id=eq.${clientId}` }, onChange)
  for (const table of ['workouts', 'workout_exercises', 'workout_sets', 'client_progress', 'client_progress_custom', 'client_custom_metrics'] as const) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `client_id=eq.${clientId}` }, onChange)
  }
  channel.subscribe()
  return () => { void supabase.removeChannel(channel) }
}
