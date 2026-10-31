interface JournalConnection {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}
interface JournalTarget {
  trainerLoginSha256: string
  trainerEmailSha256: string
  clientNameSha256: string
}
export interface JournalReceipt {
  schemaVersion: number
  trainerId: string
  clientId: string
  athleteId: string | null
  created: { ordinal: number; workoutId: string; requestId: string; workoutDate: string }[]
  replayed: boolean
  createdCard: boolean
  appendOnly?: boolean
  preservedState?: Record<string, { count: number; fingerprint: string }>
  ownerPreservedState?: Record<string, { count: number; fingerprint: string }>
  previousStateVerified?: boolean
  preservedWorkouts?: number
}
export function runPreparedNewCardImport(options: {
  mode: 'inspect' | 'apply'
  owner: JournalConnection
  runtime: JournalConnection
  target: JournalTarget
  legacyId?: string | null
  parts: string[]
  approvedSha256: string
  readRequest: (...args: never[]) => { draft: object; expectedVersion: number | null } | undefined
  saveCompleted: (...args: never[]) => Promise<{ id: string; version: number }>
  createCard: (...args: never[]) => Promise<{ id: string; version: number; membershipVersion: number }>
  persistReceipt: (state: 'prepared' | 'committed' | 'readback', receipt: JournalReceipt) => Promise<void>
  selectionBinding?: (mode: 'inspect' | 'apply', fingerprint: string) => Promise<void>
}): Promise<{
  status: 'ready' | 'already_imported' | 'imported'
  workouts: number
  exercises: number
  sets: number
  athleteLinked: boolean
  readOnly?: boolean
  contentVerified?: boolean
  willCreateCard?: boolean
  appendOnly?: boolean
  existingWorkouts?: number
  preservedWorkouts?: number
  previousStateVerified?: boolean
}>
