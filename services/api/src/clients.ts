import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'

interface ClientRow extends QueryResultRow {
  id: string
  has_account: boolean
  full_name: string
  canonical_full_name: string
  gender: 'male' | 'female' | null
  age_years: number | null
  age_updated_at: string | null
  height_cm: string | null
  goal: string | null
  note: string | null
  last_activity_at: Date
  archived_at: Date | null
  version: string
  membership_version: string
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
  currentWeightKg: null
  lastActivityAt: string
  archivedAt: string | null
  version: number
  membershipVersion: number
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

export async function readAccessibleClients(
  client: DatabaseClient,
): Promise<PilotClientsResponse> {
  const rows = await client.query<ClientRow>(`
    select
      client.id,
      client.auth_user_id is not null as has_account,
      coalesce(membership.alias, client.full_name) as full_name,
      client.full_name as canonical_full_name,
      client.gender,
      client.age_years,
      client.age_updated_at,
      client.height_cm,
      client.goal,
      membership.note,
      client.updated_at as last_activity_at,
      client.archived_at,
      client.version,
      coalesce(membership.version, 1) as membership_version
    from public.clients client
    left join public.client_trainers membership
      on membership.client_id = client.id
     and membership.trainer_id = auth.uid()
    where public.can_access_client(client.id)
      and client.archived_at is null
    order by client.updated_at desc, lower(coalesce(membership.alias, client.full_name))
  `)

  return {
    accessMode: 'read_only',
    clients: rows.map((row) => ({
      id: row.id,
      hasAccount: row.has_account,
      fullName: row.full_name,
      canonicalFullName: row.canonical_full_name,
      gender: row.gender,
      ageYears: row.age_years,
      ageUpdatedAt: row.age_updated_at,
      heightCm: row.height_cm === null ? null : Number(row.height_cm),
      goal: row.goal,
      note: row.note,
      currentWeightKg: null,
      lastActivityAt: row.last_activity_at.toISOString(),
      archivedAt: row.archived_at?.toISOString() ?? null,
      version: integer(row.version, 'client version'),
      membershipVersion: integer(row.membership_version, 'membership version'),
    })),
  }
}
