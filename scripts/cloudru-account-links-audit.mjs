import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const sha256 = /^[a-f0-9]{64}$/
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const rosterFail = code => { throw Error(`roster_audit_${code}`) }
// Database C collation does not lowercase Cyrillic. Keep this normalization
// equal to the local screenshot signature without requiring a new collation.
const nameHash = column => `encode(sha256(convert_to(replace(lower(translate(regexp_replace(btrim(${column}),'\\s+',' ','g'),
  'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ','абвгдеёжзийклмнопрстуфхцчшщъыьэюя')),'ё','е'),'UTF8')),'hex')`

export function readRosterTargets(value) {
  if (!value || Object.keys(value).join(',') !== 'rosterNameHashes'
    || !Array.isArray(value.rosterNameHashes) || value.rosterNameHashes.length < 3 || value.rosterNameHashes.length > 30
    || value.rosterNameHashes.some(hash => typeof hash !== 'string' || !sha256.test(hash))
    || new Set(value.rosterNameHashes).size !== value.rosterNameHashes.length) rosterFail('targets_invalid')
  return value
}

export const normalizedRosterNameSql = nameHash

// Match a supplied roster as a subset, using the same active access predicate
// and per-trainer display aliases as the existing clients screen. Historical
// partition keys and old note memberships alone never establish ownership.
export const rosterOwnerQuery = `with wanted as (
  select hash,ordinality::int ordinal from unnest($1::text[]) with ordinality target(hash,ordinality)
), possible_connections as (
  select c.id client_id,c.trainer_id from public.clients c
  union select client_id,trainer_id from public.client_trainers
  union select client_id,trainer_id from public.client_trainer_relationships where status='active'
  union select id,auth_user_id from public.clients where auth_user_id is not null
), current_roster as (
  select c.id client_id,c.full_name,coalesce(m.alias,c.full_name) display_name,scope.trainer_id
  from possible_connections scope join public.clients c on c.id=scope.client_id
  join public.trainers t on t.profile_id=scope.trainer_id
  left join public.client_trainers m on m.client_id=c.id and m.trainer_id=scope.trainer_id
  where c.archived_at is null and c.merged_into_client_id is null
    and (c.auth_user_id=scope.trainer_id or public.is_active_client_trainer_connection(c.id,scope.trainer_id))
), matches as (
  select distinct r.trainer_id,r.client_id,w.ordinal from current_roster r join wanted w on w.hash in (
    ${nameHash('r.display_name')},${nameHash('r.full_name')})
), per_name as (
  select trainer_id,ordinal,count(distinct client_id)::int cards from matches group by trainer_id,ordinal
), candidates as (
  select trainer_id,count(*)::int matched_names,count(*) filter(where cards<>1)::int ambiguous_names,
    array_agg(ordinal order by ordinal) matched_ordinals from per_name group by trainer_id having count(*) >= $2
)
select c.trainer_id,c.matched_names,c.ambiguous_names,c.matched_ordinals,p.account_role,
  exists(select 1 from app_private.auth_identities i where i.profile_id=c.trainer_id and i.provider='yandex') yandex_linked,
  (select count(distinct client_id)::int from matches m where m.trainer_id=c.trainer_id) matched_cards,
  (select count(distinct client_id)::int from current_roster r where r.trainer_id=c.trainer_id) active_clients
from candidates c join public.profiles p on p.id=c.trainer_id order by c.matched_names desc,c.trainer_id limit 11`

export async function inspectRosterOwners(client, input) {
  const targets = readRosterTargets(input), count = targets.rosterNameHashes.length
  await client.query('begin transaction isolation level repeatable read read only')
  try {
    await client.query("set local statement_timeout='10s'")
    await client.query("set local lock_timeout='2s'")
    const state = (await client.query("select current_user username,current_setting('transaction_read_only') readonly")).rows[0]
    if (state?.username !== 'fit_owner' || state.readonly !== 'on') rosterFail('readonly_required')
    const rows = (await client.query(rosterOwnerQuery, [targets.rosterNameHashes, Math.max(3, count - 2)])).rows
    if (!Array.isArray(rows) || rows.length > 10 || rows.some(row => !uuid.test(row.trainer_id ?? '')
      || !['trainer','client'].includes(row.account_role) || typeof row.yandex_linked !== 'boolean'
      || ![row.matched_names,row.ambiguous_names,row.matched_cards,row.active_clients].every(Number.isInteger)
      || row.matched_names < 3 || row.matched_names > count || row.ambiguous_names < 0 || row.ambiguous_names > count
      || row.matched_cards < 1 || row.active_clients < row.matched_cards || row.active_clients > 1000
      || !Array.isArray(row.matched_ordinals) || row.matched_ordinals.length !== row.matched_names
      || new Set(row.matched_ordinals).size !== row.matched_ordinals.length
      || row.matched_ordinals.some(n => !Number.isInteger(n) || n < 1 || n > count))) rosterFail('scope_exceeded')
    const candidates = rows.map((row, i) => ({ account: `candidate${i+1}`,role: row.account_role,
      yandexLinked: row.yandex_linked, matchedNames: row.matched_names, matchedCards: row.matched_cards,
      activeClients: row.active_clients, ambiguousNames: row.ambiguous_names, matchedNameNumbers: row.matched_ordinals,
      completeRosterMatch: row.matched_names === count && row.matched_cards === count && row.ambiguous_names === 0
        && row.account_role === 'trainer' && row.yandex_linked }))
    await client.query('commit')
    return { event: 'account_roster_readonly_audit', readOnly: true, productionMutated: false,
      targetNames: count, additionalClientsAllowed: true, candidates,
      completeMatches: candidates.filter(row => row.completeRosterMatch).length, actorSelected: false }
  } catch (error) { await client.query('rollback'); throw error }
}

async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'podkolzinpd/fit') throw Error('roster_audit_environment_invalid')
  const targets = readRosterTargets(JSON.parse(process.env.FIT_ACCOUNT_LINK_AUDIT_TARGETS || 'null'))
  const { buildDatabaseConnectionConfig } = await import('/app/dist/db/connection-config.js')
  const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
  if (config.host !== '10.70.10.67' || config.port !== 5432 || config.database !== 'fit' || config.user !== 'fit_owner'
    || process.env.MIGRATION_DATABASE_SSL_MODE !== 'require') throw Error('roster_audit_environment_invalid')
  const { Client } = createRequire('/app/package.json')('pg')
  const client = new Client({ ...config, connectionTimeoutMillis: 5000, query_timeout: 15000 })
  await client.connect()
  try { console.log(JSON.stringify(await inspectRosterOwners(client, targets))) } finally { await client.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(/^(roster_audit_(targets_invalid|scope_exceeded|readonly_required|environment_invalid))$/.test(error?.message)
    ? error.message : 'account_links_audit_failed')
  process.exitCode = 1
})
