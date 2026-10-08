import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'
import { PilotDomainCommandError } from './domain-commands.js'

export const SPORT_INTEREST_IDS = [
  'strength', 'functional', 'crossfit', 'calisthenics', 'yoga', 'pilates',
  'stretching', 'dance', 'running', 'trail_running', 'walking', 'cycling',
  'swimming', 'rowing', 'triathlon', 'football', 'basketball', 'volleyball',
  'tennis', 'table_tennis', 'badminton', 'boxing', 'wrestling', 'mma',
  'hiking', 'climbing', 'skiing', 'snowboarding', 'skating', 'other',
] as const

const allowedSports = new Set<string>(SPORT_INTEREST_IDS)

export interface AthleteSportProfile {
  sports: string[]
  bio: string | null
}

interface ProfileRow extends QueryResultRow {
  sports: string[]
  bio: string | null
}

export function readAthleteSportProfile(value: unknown): AthleteSportProfile | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const { sports, bio } = value as Record<string, unknown>
  if (!Array.isArray(sports)) return undefined
  const selected: unknown[] = sports
  if (!selected.every((sport): sport is string => typeof sport === 'string' && allowedSports.has(sport))) return undefined
  if (new Set(selected).size !== selected.length) return undefined
  if (bio !== null && (typeof bio !== 'string' || bio.trim().length > 160)) return undefined
  return { sports: selected, bio: typeof bio === 'string' ? bio.trim() || null : null }
}

export async function assertAthlete(client: DatabaseClient): Promise<void> {
  const rows = await client.query(
    "select 1 from public.profiles where id = auth.uid() and account_role = 'client'",
  )
  if (rows.length !== 1) throw new PilotDomainCommandError('forbidden')
}

export async function getOwnAthleteSportProfile(client: DatabaseClient): Promise<AthleteSportProfile> {
  await assertAthlete(client)
  const rows = await client.query<ProfileRow>(
    'select sports, bio from public.athlete_sport_profiles where profile_id = auth.uid()',
  )
  return rows[0] ?? { sports: [], bio: null }
}

export async function saveOwnAthleteSportProfile(client: DatabaseClient, profile: AthleteSportProfile): Promise<void> {
  await client.query(
    `insert into public.athlete_sport_profiles (profile_id, sports, bio)
     values (auth.uid(), $1::text[], $2)
     on conflict (profile_id) do update set sports = excluded.sports, bio = excluded.bio`,
    [profile.sports, profile.bio],
  )
}
