import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'

interface ProfileRow extends QueryResultRow {
  id: string
  first_name: string | null
  last_name: string | null
  timezone: string
  account_role: 'trainer' | 'client'
}

export interface ProfileResponse {
  accessMode: 'read_only'
  profile: {
    id: string
    firstName: string | null
    lastName: string | null
    timezone: string
    accountRole: 'trainer' | 'client'
  }
}

export async function readOwnProfile(
  client: DatabaseClient,
): Promise<ProfileResponse | undefined> {
  const rows = await client.query<ProfileRow>(`
    select id, first_name, last_name, timezone, account_role
    from public.profiles
    where id = auth.uid()
  `)
  const row = rows[0]
  if (row === undefined) return undefined

  return {
    accessMode: 'read_only',
    profile: {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      timezone: row.timezone,
      accountRole: row.account_role,
    },
  }
}
