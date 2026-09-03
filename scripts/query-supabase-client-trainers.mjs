import { pathToFileURL } from 'node:url'

// Fixed, parameterized, read-only query. No emails, workout contents, secrets,
// arbitrary SQL, or unrelated accounts are returned to the diagnostic log.
export const CLIENT_TRAINERS_QUERY = `
select client.id as client_id,
  client.auth_user_id,
  client.trainer_id as owner_id,
  client.archived_at is not null as archived,
  client.merged_into_client_id,
  (select count(*) from public.workouts where client_id = client.id) as workout_count,
  (select count(*) from public.client_goals where client_id = client.id) as goal_count,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'trainer_id', membership.trainer_id,
      'first_name', left(profile.first_name, 80),
      'joined_at', membership.joined_at,
      'is_root', membership.trainer_id = client.trainer_id
    ) order by membership.joined_at, membership.trainer_id)
    from public.client_trainers membership
    join public.profiles profile on profile.id = membership.trainer_id
    where membership.client_id = client.id
  ), '[]'::jsonb) as memberships,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'trainer_id', relationship.trainer_id,
      'status', relationship.status,
      'connected_at', relationship.connected_at,
      'disconnected_at', relationship.disconnected_at
    ) order by relationship.connected_at, relationship.id)
    from public.client_trainer_relationships relationship
    where relationship.client_id = client.id
  ), '[]'::jsonb) as relationships
from public.clients client
join auth.users account on account.id = client.auth_user_id
where encode(extensions.digest(lower(btrim(account.email)), 'sha256'), 'hex') = $1
order by client.created_at, client.id
limit 20
`

export async function queryClientTrainers({ accessToken, projectId, emailHash, fetchImplementation = fetch }) {
  if (typeof emailHash !== 'string' || !/^[a-f0-9]{64}$/.test(emailHash)) {
    throw new Error('A lowercase SHA-256 email hash is required')
  }
  if (typeof projectId !== 'string' || !/^[a-z]{20}$/.test(projectId)) {
    throw new Error('SUPABASE_PROJECT_ID is invalid')
  }
  if (!accessToken?.trim()) throw new Error('SUPABASE_ACCESS_TOKEN is required')
  const response = await fetchImplementation(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: CLIENT_TRAINERS_QUERY, parameters: [emailHash], read_only: true }),
  })
  if (!response.ok) throw new Error(`Client trainer diagnostic failed with HTTP ${response.status}`)
  const rows = await response.json()
  if (!Array.isArray(rows)) throw new Error('Client trainer diagnostic returned an invalid result')
  const allowedKeys = new Set(['client_id', 'auth_user_id', 'owner_id', 'archived', 'merged_into_client_id', 'workout_count', 'goal_count', 'memberships', 'relationships'])
  return rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => allowedKeys.has(key))))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  queryClientTrainers({
    accessToken: process.env.SUPABASE_ACCESS_TOKEN,
    projectId: process.env.SUPABASE_PROJECT_ID,
    emailHash: process.argv[2],
  }).then(rows => console.log(JSON.stringify(rows, null, 2))).catch(() => {
    console.error('Client trainer diagnostic failed; sensitive response details suppressed')
    process.exitCode = 1
  })
}
