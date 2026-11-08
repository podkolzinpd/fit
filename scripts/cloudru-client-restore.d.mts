interface RestoreConnection {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}
export interface RestorePair { trainerId: string; athleteId: string }
export interface ExpectedRestoreHistory { clientId: string; workoutIds: string[]; workouts: number; exercises: number; sets: number }
export interface CurrentProfileEvidence { messageSha256: string; since: string }
export interface ConfirmedRestoreInvitation { invitationId: string; claimedAt: string; ownerConfirmedAt: string }
export interface ImportedAccessAuditTarget { code: string; profileId: string | null; journalKind: 'athlete' | 'trainer_self'; expectedHistory: ExpectedRestoreHistory }
export interface RestorePlan {
  periodId: string
  state: { card: { id: string }; source: { id: string }; history: unknown }
  [key: string]: unknown
}
export function readRestoreTarget(raw: string | undefined): RestorePair
export function readExpectedRestoreHistory(value: unknown): ExpectedRestoreHistory
export function readCurrentProfileEvidence(value: unknown, now?: number): CurrentProfileEvidence
export function readConfirmedRestoreInvitation(value: unknown, now?: number): ConfirmedRestoreInvitation
export function readConfirmedRestoreVisibility(client: RestoreConnection, diagnostic: unknown): Promise<Record<string, unknown>>
export function readImportedAccessAudit(value: unknown): ImportedAccessAuditTarget[]
export function readImportedAccessVisibility(client: RestoreConnection, diagnostic: unknown): Promise<Record<string, unknown>[]>
export function planClientRestore(client: RestoreConnection, pair: RestorePair, expectedHistory?: ExpectedRestoreHistory | null, currentProfileEvidence?: CurrentProfileEvidence | null, confirmedInvitation?: ConfirmedRestoreInvitation | null, importedAccessAudit?: ImportedAccessAuditTarget[] | null, repairMode?: 'merge_confirmed_cards' | null, auditDetailCodes?: string[] | null): Promise<RestorePlan>
export function applyClientRestore(client: RestoreConnection, plan: RestorePlan, options?: { backupVerified: boolean }): Promise<Record<string, unknown>>
export function verifyClientRestore(client: RestoreConnection, plan: RestorePlan): Promise<Record<string, unknown>>
export function privateRestoreTechnicalResult(result: Record<string, unknown>): Record<string, unknown>

export function readConfirmedCardRepairMode(value: unknown): 'merge_confirmed_cards'
export function verifyConfirmedCardMergeOwner(client: RestoreConnection, plan: RestorePlan): Promise<Record<string, unknown>>
export function validateCardMergePlan(plan: RestorePlan): void
export function readAuditDetailCodes(value: unknown, scope: ImportedAccessAuditTarget[] | null): string[]
