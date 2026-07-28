import { subscribeToClientChanges } from '../queries/realtime.queries'

export const realtimeRepository = { subscribeToClientChanges }
export type { ClientRealtimeChange, ClientRealtimeTable } from '../queries/realtime.queries'
