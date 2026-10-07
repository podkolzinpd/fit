import type { QueryResultRow } from 'pg'
import type { DatabaseClient } from './db/types.js'

type PublishedNameRow = QueryResultRow & { trainer_id: string; display_name: string | null }

/** Read published names only; an unpublished draft must never become a client identity. */
export async function readTrainerDisplayNames(
  client: DatabaseClient,
  trainers: readonly { trainerId: string; accountName: string | null }[],
): Promise<Map<string, string>> {
  const names = new Map(trainers.map(({ trainerId, accountName }) =>
    [trainerId, accountName?.trim() || 'Тренер']))
  if (names.size === 0) return names
  const rows = await client.query<PublishedNameRow>(`
    select trainer_id, nullif(btrim(published_data->>'displayName'), '') as display_name
    from public.trainer_professional_profiles
    where trainer_id = any($1::uuid[]) and published_data is not null
  `, [[...names.keys()]])
  for (const row of rows) {
    if (names.has(row.trainer_id) && row.display_name) names.set(row.trainer_id, row.display_name)
  }
  return names
}
