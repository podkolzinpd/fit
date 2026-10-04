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
  trainer_schedule_v2: boolean
  client_lime: boolean
  fit_lime: boolean
  assistant_feature_links: boolean
  schedule_density: 'comfortable' | 'compact'
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
    experiments: {
      trainerScheduleV2: boolean
      clientLime?: boolean
      fitLime: boolean
      assistantFeatureLinks?: boolean
    }
    preferences?: {
      scheduleDensity: 'comfortable' | 'compact'
    }
  }
}

export async function readOwnProfile(
  client: DatabaseClient,
  accessMode: ProfileResponse['accessMode'] = 'read_only',
): Promise<ProfileResponse | undefined> {
  const rows = await client.query<ProfileRow>(`
    select profile.id, profile.first_name, profile.last_name,
      profile.timezone, profile.account_role, profile.schedule_density,
      client.id client_id, client.trainer_id client_trainer_id,
      client.full_name client_full_name,
      app_private.trainer_schedule_v2_enabled() trainer_schedule_v2,
      app_private.fit_lime_enabled() fit_lime,
      app_private.client_lime_enabled() client_lime,
      app_private.assistant_feature_links_enabled() assistant_feature_links
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
      experiments: {
        trainerScheduleV2: row.trainer_schedule_v2 === true,
        fitLime: row.fit_lime === true,
        clientLime: row.client_lime === true,
        assistantFeatureLinks: row.assistant_feature_links === true,
      },
      preferences: {
        scheduleDensity: row.schedule_density,
      },
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
