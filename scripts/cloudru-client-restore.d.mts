interface RestoreConnection {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}
export interface RestorePair { trainerId: string; athleteId: string }
export interface ExpectedRestoreHistory { clientId: string; workoutIds: string[]; workouts: number; exercises: number; sets: number }
export interface RestorePlan {
  periodId: string
  state: { card: { id: string }; source: { id: string }; history: unknown }
  [key: string]: unknown
}
export function readRestoreTarget(raw: string | undefined): RestorePair
export function readExpectedRestoreHistory(value: unknown): ExpectedRestoreHistory
export function planClientRestore(client: RestoreConnection, pair: RestorePair, expectedHistory?: ExpectedRestoreHistory | null): Promise<RestorePlan>
export function applyClientRestore(client: RestoreConnection, plan: RestorePlan, options?: { backupVerified: boolean }): Promise<Record<string, unknown>>
export function verifyClientRestore(client: RestoreConnection, plan: RestorePlan): Promise<Record<string, unknown>>
export function privateRestoreTechnicalResult(result: Record<string, unknown>): Record<string, unknown>
