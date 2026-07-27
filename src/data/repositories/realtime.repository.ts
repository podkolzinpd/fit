import { subscribeToClientChanges } from '../queries/realtime.queries'
export type { ClientRealtimeChange } from '../queries/realtime.queries'

export const realtimeRepository = { subscribeToClientChanges }
