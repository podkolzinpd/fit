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
