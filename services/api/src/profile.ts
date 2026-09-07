import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'

interface ProfileRow extends QueryResultRow {
  id: string
  first_name: string | null
  last_name: string | null
  timezone: string
  account_role: 'trainer' | 'client'
  client_id: string | null
  client_trainer_id: string | null
  client_full_name: string | null
}

export interface ProfileResponse {
  accessMode: 'read_only' | 'read_write'
  profile: {
    id: string
    firstName: string | null
    lastName: string | null
    timezone: string
    accountRole: 'trainer' | 'client'
    client?: {
      id: string
      trainerId: string
      fullName: string
    } | null
  }
}

export async function readOwnProfile(
  client: DatabaseClient,
  accessMode: ProfileResponse['accessMode'] = 'read_only',
): Promise<ProfileResponse | undefined> {
  const rows = await client.query<ProfileRow>(`
    select profile.id, profile.first_name, profile.last_name,
      profile.timezone, profile.account_role,
      client.id client_id, client.trainer_id client_trainer_id,
      client.full_name client_full_name
    from public.profiles profile
    left join public.clients client
      on client.auth_user_id = profile.id
      and client.merged_into_client_id is null
    where profile.id = auth.uid()
  `)
  const row = rows[0]
  if (row === undefined) return undefined

  return {
    accessMode,
    profile: {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      timezone: row.timezone,
      accountRole: row.account_role,
      client: row.client_id !== null
        && row.client_trainer_id !== null
        && row.client_full_name !== null
        ? {
            id: row.client_id,
            trainerId: row.client_trainer_id,
            fullName: row.client_full_name,
          }
        : null,
    },
  }
}
