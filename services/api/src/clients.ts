import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'

interface ClientRow extends QueryResultRow {
  id: string
  has_account: boolean
  full_name: string
  canonical_full_name: string
  gender: 'male' | 'female' | null
  age_years: number | null
  age_updated_at: string | Date | null
  height_cm: string | null
  goal: string | null
  note: string | null
  current_weight_kg: string | null
  last_activity_at: Date
  archived_at: Date | null
  version: string
  membership_version: string
  done_count: number
  completion_percent: number | null
  last_workout_date: string | Date | null
  days_in_work: number | null
  needs_attention: boolean
}

export interface PilotClient {
  id: string
  hasAccount: boolean
  fullName: string
  canonicalFullName: string
  gender: 'male' | 'female' | null
  ageYears: number | null
  ageUpdatedAt: string | null
  heightCm: number | null
  goal: string | null
  note: string | null
  currentWeightKg: number | null
  lastActivityAt: string
  archivedAt: string | null
  version: number
  membershipVersion: number
  activity: {
    doneCount: number
    completionPercent: number | null
    lastWorkoutDate: string | null
    daysInWork: number | null
    needsAttention: boolean
  }
}

export interface PilotClientsResponse {
  accessMode: 'read_only'
  clients: PilotClient[]
}

function integer(value: string, field: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} must be a safe integer`)
  return parsed
}

function localDate(value: string | Date | null): string | null {
  if (value === null || typeof value === 'string') return value
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function readAccessibleClients(
  client: DatabaseClient,
  archived = false,
): Promise<PilotClientsResponse> {
  const rows = await client.query<ClientRow>(
    'select * from public.list_client_overviews($1)',
    [archived],
  )

  return {
    accessMode: 'read_only',
    clients: rows.map((row) => ({
      id: row.id,
      hasAccount: row.has_account,
      fullName: row.full_name,
      canonicalFullName: row.canonical_full_name,
      gender: row.gender,
      ageYears: row.age_years,
      ageUpdatedAt: localDate(row.age_updated_at),
      heightCm: row.height_cm === null ? null : Number(row.height_cm),
      goal: row.goal,
      note: row.note,
      currentWeightKg: row.current_weight_kg === null ? null : Number(row.current_weight_kg),
      lastActivityAt: row.last_activity_at.toISOString(),
      archivedAt: row.archived_at?.toISOString() ?? null,
      version: integer(row.version, 'client version'),
      membershipVersion: integer(row.membership_version, 'membership version'),
      activity: {
        doneCount: row.done_count,
        completionPercent: row.completion_percent,
        lastWorkoutDate: localDate(row.last_workout_date),
        daysInWork: row.days_in_work,
        needsAttention: row.needs_attention,
      },
    })),
  }
}
