import { pathToFileURL } from 'node:url'

// Parameters arrive only through an encrypted, masked GitHub secret. Public
// diagnostic logs contain a fixed set of booleans: no identifiers or contents.
export const CLIENT_TRAINERS_QUERY = `
with account as (
  select id from auth.users
  where encode(extensions.digest(lower(btrim(email)), 'sha256'), 'hex') = $1
), client as (
  select c.id, c.auth_user_id, c.trainer_id
  from public.clients c join account a on a.id = c.auth_user_id
  where c.archived_at is null and c.merged_into_client_id is null
), linked as (
  select m.trainer_id from public.client_trainers m join client c on c.id = m.client_id
  union
  select r.trainer_id from public.client_trainer_relationships r join client c on c.id = r.client_id
), target as (
  select p.id from linked join public.profiles p on p.id = linked.trainer_id
  where encode(extensions.digest(lower(btrim(p.first_name)), 'sha256'), 'hex') = $2
)
select
  (select count(*) = 1 from account) as account_unique,
  (select count(*) = 1 from client) as client_unique,
  exists(select 1 from client where trainer_id = auth_user_id) as self_owned,
  (select count(*) = 1 from target) as target_unique,
  exists(select 1 from public.client_trainers m join client c on c.id = m.client_id join target t on t.id = m.trainer_id) as target_membership_present,
  exists(select 1 from public.client_trainer_relationships r join client c on c.id = r.client_id join target t on t.id = r.trainer_id where r.status = 'active') as target_relationship_active,
  exists(select 1 from public.client_trainer_relationships r join client c on c.id = r.client_id join target t on t.id = r.trainer_id where r.status = 'disconnected') as target_relationship_disconnected,
  exists(select 1 from public.client_trainers m join client c on c.id = m.client_id where not exists(select 1 from target t where t.id = m.trainer_id)) as other_trainers_present
`

const RESULT_KEYS = ['account_unique', 'client_unique', 'self_owned', 'target_unique', 'target_membership_present', 'target_relationship_active', 'target_relationship_disconnected', 'other_trainers_present']

export async function queryClientTrainers({ accessToken, projectId, emailHash, trainerNameHash, fetchImplementation = fetch }) {
  if ([emailHash, trainerNameHash].some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) {
    throw new Error('Lowercase SHA-256 lookup hashes are required')
  }
  if (typeof projectId !== 'string' || !/^[a-z]{20}$/.test(projectId)) throw new Error('SUPABASE_PROJECT_ID is invalid')
  if (!accessToken?.trim()) throw new Error('SUPABASE_ACCESS_TOKEN is required')
  const response = await fetchImplementation(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: CLIENT_TRAINERS_QUERY, parameters: [emailHash, trainerNameHash], read_only: true }),
  })
  if (!response.ok) throw new Error(`Client trainer diagnostic failed with HTTP ${response.status}`)
  const rows = await response.json()
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]) throw new Error('Invalid diagnostic result')
  const result = Object.fromEntries(RESULT_KEYS.map(key => [key, rows[0][key]]))
  if (Object.values(result).some(value => typeof value !== 'boolean')) throw new Error('Invalid diagnostic result')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const lookup = JSON.parse(process.env.FIT_CLIENT_TRAINER_DIAGNOSTIC ?? '{}')
    const result = await queryClientTrainers({
      accessToken: process.env.SUPABASE_ACCESS_TOKEN,
      projectId: process.env.SUPABASE_PROJECT_ID,
      emailHash: lookup.emailHash,
      trainerNameHash: lookup.trainerNameHash,
    })
    console.log(JSON.stringify(result, null, 2))
  } catch {
    console.error('Client trainer diagnostic failed; sensitive response details suppressed')
    process.exitCode = 1
  }
}
