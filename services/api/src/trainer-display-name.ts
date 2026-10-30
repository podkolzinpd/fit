import type { QueryResultRow } from 'pg'
import type { DatabaseClient } from './db/types.js'

type PublishedNameRow = QueryResultRow & { trainer_id: string; display_name: string | null; public_id: string }

export interface TrainerPublishedIdentity { displayName: string; publicId: string | null }

/** Read published names only; an unpublished draft must never become a client identity. */
export async function readTrainerDisplayNames(
  client: DatabaseClient,
  trainers: readonly { trainerId: string; accountName: string | null }[],
): Promise<Map<string, string>> {
  const identities = await readTrainerPublishedIdentities(client, trainers)
  return new Map([...identities].map(([id, identity]) => [id, identity.displayName]))
}

export async function readTrainerPublishedIdentities(
  client: DatabaseClient,
  trainers: readonly { trainerId: string; accountName: string | null }[],
): Promise<Map<string, TrainerPublishedIdentity>> {
  const names = new Map<string, TrainerPublishedIdentity>(trainers.map(({ trainerId, accountName }) =>
    [trainerId, { displayName: accountName?.trim() || 'Тренер', publicId: null }]))
  if (names.size === 0) return names
  const rows = await client.query<PublishedNameRow>(`
    select trainer_id, public_id, nullif(btrim(published_data->>'displayName'), '') as display_name
    from public.trainer_professional_profiles
    where trainer_id = any($1::uuid[]) and published_data is not null
  `, [[...names.keys()]])
  for (const row of rows) {
    const existing = names.get(row.trainer_id)
    if (existing) names.set(row.trainer_id, { displayName: row.display_name || existing.displayName, publicId: row.public_id ?? null })
  }
  return names
}
