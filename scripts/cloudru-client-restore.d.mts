interface RestoreConnection {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}
export interface RestorePair { trainerId: string; athleteId: string }
export interface RestorePlan {
  periodId: string
  state: { card: { id: string }; source: { id: string }; history: unknown }
  [key: string]: unknown
}
export function readRestoreTarget(raw: string | undefined): RestorePair
export function planClientRestore(client: RestoreConnection, pair: RestorePair): Promise<RestorePlan>
export function applyClientRestore(client: RestoreConnection, plan: RestorePlan, options?: { backupVerified: boolean }): Promise<Record<string, unknown>>
export function verifyClientRestore(client: RestoreConnection, plan: RestorePlan): Promise<Record<string, unknown>>
