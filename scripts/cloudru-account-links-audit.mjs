import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readHistoryRegistry } from './cloudru-account-history-audit.mjs'

const sha256 = /^[a-f0-9]{64}$/
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const bound = (rows, maximum) => {
  if (!Array.isArray(rows) || rows.length > maximum) throw Error('account_links_scope_exceeded')
  return rows
}
const quote = value => '"' + value.replaceAll('"', '""') + '"'

export function readAccountLinkTargets(raw) {
  let value
  try { value = JSON.parse(raw) } catch { throw Error('account_links_targets_invalid') }
  if (!value || Object.keys(value).sort().join(',') !== 'emailHashes,loginHashes'
    || !Array.isArray(value.emailHashes) || value.emailHashes.length < 2 || value.emailHashes.length > 4
    || !Array.isArray(value.loginHashes) || value.loginHashes.length < 1 || value.loginHashes.length > 4
    || [...value.emailHashes, ...value.loginHashes].some(hash => typeof hash !== 'string' || !sha256.test(hash))
    || new Set(value.emailHashes).size !== value.emailHashes.length
    || new Set(value.loginHashes).size !== value.loginHashes.length) throw Error('account_links_targets_invalid')
  return value
}

// No names, contacts, IDs, login/subject hashes or session tokens leave this transaction.
export async function inspectAccountLinks(client, targets, legacyMatches) {
  await client.query('begin transaction isolation level repeatable read read only')
  try {
    await client.query("set local statement_timeout='10s'")
    await client.query("set local lock_timeout='2s'")
    const state = (await client.query("select current_user username,current_setting('transaction_read_only') readonly")).rows[0]
    if (state?.username !== 'fit_owner' || state.readonly !== 'on') throw Error('account_links_readonly_required')
    const hashes = [...new Set([...targets.emailHashes, ...targets.loginHashes])]
    // Discover every retained login-binding table by its exact column contract.
    // Only app_private base tables are accepted; identifiers come from pg_catalog.
    const tables = bound((await client.query(`select c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app_private' and c.relkind='r'
      and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='login_sha256' and not a.attisdropped)
      and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='profile_id' and not a.attisdropped)
      order by c.relname limit 21`)).rows, 20)
    const bindings = []
    for (const table of tables) {
      const rows = bound((await client.query(`select profile_id,login_sha256 from app_private.${quote(table.name)}
        where login_sha256=any($1::text[]) and profile_id is not null limit 21`, [hashes])).rows, 20)
      bindings.push(...rows.map(row => ({ ...row, source: table.name })))
    }
    const ids = [...new Set([...legacyMatches.map(row => row.id), ...bindings.map(row => row.profile_id)])].sort()
    if (ids.length > 10 || ids.some(id => !uuid.test(id))) throw Error('account_links_scope_exceeded')
    const labels = new Map(ids.map((id, i) => [id, `account${i + 1}`]))
    const profiles = bound((await client.query(`select p.id,p.account_role,
      exists(select 1 from public.trainers t where t.profile_id=p.id) trainer_card,
      (select i.identity_origin from app_private.auth_identities i where i.provider='yandex' and i.profile_id=p.id) identity_origin,
      (select count(*)::integer from app_private.yandex_app_sessions s where s.profile_id=p.id and s.revoked_at is null and s.expires_at>now()) active_sessions,
      r.target_backend,r.access_mode,r.enabled
      from public.profiles p left join app_private.profile_rollout_assignments r on r.profile_id=p.id
      where p.id=any($1::uuid[]) order by p.id limit 11`, [ids])).rows, 10)
    const cards = bound((await client.query(`with recursive scope as (
      select c.id,c.merged_into_client_id,array[c.id] path from public.clients c
      where c.auth_user_id=any($1::uuid[]) or c.trainer_id=any($1::uuid[])
        or exists(select 1 from public.client_trainers ct where ct.client_id=c.id and ct.trainer_id=any($1::uuid[]))
        or exists(select 1 from public.client_trainer_relationships r where r.client_id=c.id and r.trainer_id=any($1::uuid[]))
      union all select c.id,c.merged_into_client_id,s.path||c.id from scope s
        join public.clients c on c.id=s.merged_into_client_id or c.merged_into_client_id=s.id
        where not c.id=any(s.path) and cardinality(s.path)<20
      ) select distinct c.id,c.auth_user_id,c.trainer_id,c.archived_at is not null archived,
        c.merged_into_client_id,(select max(cardinality(path))>=20 from scope) depth_limit_hit
      from public.clients c join scope s on s.id=c.id order by c.id limit 1001`, [ids])).rows, 1000)
    if (cards.some(card => card.depth_limit_hit)) throw Error('account_links_scope_exceeded')
    const cardLabels = new Map(cards.map((card, i) => [card.id, `card${i + 1}`]))
    const relationships = bound((await client.query(`select client_id,trainer_id,status,count(*)::integer count
      from public.client_trainer_relationships where trainer_id=any($1::uuid[])
        or client_id in(select id from public.clients where auth_user_id=any($1::uuid[]))
      group by client_id,trainer_id,status order by client_id,trainer_id,status limit 2001`, [ids])).rows, 2000)
    const memberships = bound((await client.query(`select client_id,trainer_id from public.client_trainers
      where trainer_id=any($1::uuid[]) or client_id in(select id from public.clients where auth_user_id=any($1::uuid[]))
      order by client_id,trainer_id limit 2001`, [ids])).rows, 2000)
    const workouts = bound((await client.query(`select client_id,status,deleted_at is not null deleted,count(*)::integer count
      from public.workouts where client_id=any($1::uuid[]) group by client_id,status,deleted_at is not null
      order by client_id,status,deleted limit 10001`, [cards.map(card => card.id)])).rows, 10000)
    const invitations = bound((await client.query(`select created_by,claimed_by,target_role,
      case when revoked_at is not null then 'revoked' when claimed_at is not null then 'claimed'
        when expires_at<=now() then 'expired' else 'pending' end state,count(*)::integer count
      from public.client_invitations where created_by=any($1::uuid[]) or claimed_by=any($1::uuid[])
      group by created_by,claimed_by,target_role,state limit 2001`, [ids])).rows, 2000)
    const profileLabel = id => labels.get(id) ?? (id ? 'otherAccount' : 'unclaimed')
    const report = { event: 'account_links_readonly_audit', readOnly: true,
      targets: targets.emailHashes.map((hash, i) => ({ target: `address${i + 1}`,
        legacyAccount: labels.get(legacyMatches.find(row => row.label === `address${i + 1}`)?.id) ?? null,
        retainedAccounts: [...new Set(bindings.filter(row => row.login_sha256 === hash).map(row => profileLabel(row.profile_id)))] })),
      loginAccounts: [...new Set(bindings.filter(row => targets.loginHashes.includes(row.login_sha256)).map(row => profileLabel(row.profile_id)))],
      profiles: profiles.map(row => ({ account: profileLabel(row.id), role: row.account_role, trainerCard: row.trainer_card,
        yandexLinked: row.identity_origin !== null, identityOrigin: row.identity_origin, activeSessions: row.active_sessions,
        rollout: row.target_backend === null ? null : { backend: row.target_backend, mode: row.access_mode, enabled: row.enabled },
        bindingSources: [...new Set(bindings.filter(item => item.profile_id === row.id).map(item => item.source))] })),
      cards: cards.map(row => ({ card: cardLabels.get(row.id), owner: profileLabel(row.auth_user_id),
        historicalPartition: profileLabel(row.trainer_id), archived: row.archived,
        mergedInto: row.merged_into_client_id ? cardLabels.get(row.merged_into_client_id) ?? 'outsideScope' : null })),
      relationships: relationships.map(row => ({ card: cardLabels.get(row.client_id) ?? 'outsideScope', trainer: profileLabel(row.trainer_id), status: row.status, count: row.count })),
      memberships: memberships.map(row => ({ card: cardLabels.get(row.client_id) ?? 'outsideScope', trainer: profileLabel(row.trainer_id) })),
      workouts: workouts.map(row => ({ card: cardLabels.get(row.client_id), status: row.status, deleted: row.deleted, count: row.count })),
      invitations: invitations.map(row => ({ creator: profileLabel(row.created_by), claimant: profileLabel(row.claimed_by), role: row.target_role, state: row.state, count: row.count })),
      limitation: 'Native accounts without a retained login binding cannot be resolved from email/login alone. No match does not prove absence. Other accounts are not identified.' }
    await client.query('commit')
    return report
  } catch (error) { await client.query('rollback'); throw error }
}

async function json(url, headers) {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Error('account_links_registry_unavailable')
  const chunks = []; let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 5 * 1024 * 1024) throw Error('account_links_registry_too_large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'podkolzinpd/fit') throw Error('account_links_environment_invalid')
  const targets = readAccountLinkTargets(process.env.FIT_ACCOUNT_LINK_AUDIT_TARGETS)
  const project = process.env.SUPABASE_PROJECT_ID
  if (!/^[a-z0-9]{20}$/.test(project ?? '')) throw Error('account_links_environment_invalid')
  const keys = bound(await json(`https://api.supabase.com/v1/projects/${project}/api-keys`, { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` }), 20)
  const key = keys.find(item => item.name === 'service_role')?.api_key
  if (typeof key !== 'string' || !key) throw Error('account_links_registry_unavailable')
  const matches = await readHistoryRegistry(page => json(`https://${project}.supabase.co/auth/v1/admin/users?page=${page}&per_page=1000`,
    { Authorization: `Bearer ${key}`, apikey: key }), targets.emailHashes.map((hash, i) => ({ label: `address${i + 1}`, emailHash: hash })))
  const { buildDatabaseConnectionConfig } = await import('/app/dist/db/connection-config.js')
  const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
  if (config.host !== '10.70.10.67' || config.port !== 5432 || config.database !== 'fit' || config.user !== 'fit_owner'
    || process.env.MIGRATION_DATABASE_SSL_MODE !== 'require') throw Error('account_links_environment_invalid')
  const { Client } = createRequire('/app/package.json')('pg')
  const client = new Client({ ...config, connectionTimeoutMillis: 5000, query_timeout: 15000 })
  await client.connect()
  try { console.log(JSON.stringify(await inspectAccountLinks(client, targets, matches))) } finally { await client.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(/^(account_links_(targets_invalid|scope_exceeded|readonly_required|environment_invalid|registry_unavailable|registry_too_large)|history_audit_registry_(invalid|ambiguous|incomplete))$/.test(error?.message)
    ? error.message : 'account_links_audit_failed')
  process.exitCode = 1
})
