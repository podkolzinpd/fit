import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// The reviewed hashes stay in an encrypted Actions secret, never in source.
// No contacts, SQL, session tokens or user IDs are workflow-dispatch inputs.
const historyTargetRoles = { trainerLegacy: 'trainer', trainerYandex: 'trainer', athleteLegacy: 'client', athleteYandex: 'client' }
export function readHistoryTargets(raw) {
  let targets
  try { targets = JSON.parse(raw) } catch { throw new Error('history_audit_targets_invalid') }
  if (!Array.isArray(targets) || targets.length !== 4 || targets.some(target => !target
    || Object.keys(target).sort().join(',') !== 'emailHash,label,role'
    || !Object.hasOwn(historyTargetRoles, target.label) || historyTargetRoles[target.label] !== target.role
    || typeof target.emailHash !== 'string' || !/^[a-f0-9]{64}$/.test(target.emailHash))
    || new Set(targets.map(target => target.label)).size !== 4
    || new Set(targets.map(target => target.emailHash)).size !== 4) throw new Error('history_audit_targets_invalid')
  return targets
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const digest = value => createHash('sha256').update(value).digest('hex')
const requireBound = (rows, maximum) => {
  if (!Array.isArray(rows) || rows.length > maximum) throw new Error('history_audit_scope_exceeded')
  return rows
}

export function readHistoryEvidenceSecret(raw) {
  if (!raw) return null
  let evidence
  try { evidence = JSON.parse(raw) } catch { throw new Error('history_audit_evidence_invalid') }
  if (!evidence || Object.keys(evidence).sort().join(',') !== 'idSha256,messageSha256'
    || ![evidence.idSha256, evidence.messageSha256].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) {
    throw new Error('history_audit_evidence_invalid')
  }
  return evidence
}

// Called only after the owner's READ ONLY gate; the private ID never enters SQL or output.
export async function resolveHistoryEvidence(client, evidence) {
  if (!evidence) return null
  const rows = requireBound((await client.query(`select 'feedback' kind, f.user_id profile_id, p.account_role,
    encode(sha256(convert_to(btrim(f.message), 'UTF8')), 'hex') = $2 marker_matches
    from public.app_feedback f join public.profiles p on p.id = f.user_id
    where encode(sha256(convert_to(f.id::text, 'UTF8')), 'hex') = $1
    union all select 'profile', p.id, p.account_role, true from public.profiles p
    where encode(sha256(convert_to(p.id::text, 'UTF8')), 'hex') = $1
    union all select 'card', c.auth_user_id, p.account_role, true from public.clients c
    left join public.profiles p on p.id = c.auth_user_id
    where encode(sha256(convert_to(c.id::text, 'UTF8')), 'hex') = $1 limit 4`,
  [evidence.idSha256, evidence.messageSha256])).rows, 3)
  if (!rows.length) throw new Error('history_audit_evidence_not_found')
  if (rows.some(row => !row.marker_matches)) throw new Error('history_audit_evidence_feedback_mismatch')
  if (rows.some(row => row.account_role !== 'client' || !uuid.test(row.profile_id ?? ''))) throw new Error('history_audit_evidence_role_mismatch')
  if (new Set(rows.map(row => row.profile_id)).size !== 1) throw new Error('history_audit_evidence_ambiguous')
  return { profileId: rows[0].profile_id, kinds: rows.map(row => row.kind) }
}

export async function readHistoryVisibility(client, actorId, workoutIds) {
  await client.query('begin transaction isolation level repeatable read read only')
  try {
    await client.query("set local statement_timeout = '10s'")
    await client.query("set local lock_timeout = '2s'")
    const result = await client.query(`select current_setting('transaction_read_only') readonly,
      current_user name, rolsuper, rolbypassrls from pg_roles where rolname = current_user`)
    const role = result.rows[0]
    if (role?.readonly !== 'on' || role.name !== 'fit_api' || role.rolsuper !== false || role.rolbypassrls !== false) {
      throw new Error('history_audit_runtime_role_invalid')
    }
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [actorId])
    const rows = await client.query('select count(*)::integer count from public.workouts where id = any($1::uuid[])', [workoutIds])
    await client.query('commit')
    return rows.rows[0].count
  } catch (error) { await client.query('rollback'); throw error }
}

export async function readHistoryRegistry(listPage, targets) {
  const matches = []
  const seen = new Set()
  for (let page = 1; page <= 20; page++) {
    const result = await listPage(page)
    requireBound(result?.users, 1000)
    if (result.users.length === 0) return matches
    for (const user of result.users) {
      if (!uuid.test(user?.id ?? '') || seen.has(user.id)) throw new Error('history_audit_registry_invalid')
      seen.add(user.id)
      if (typeof user.email !== 'string') continue
      const target = targets.find(item => item.emailHash === digest(user.email.trim().toLowerCase()))
      if (!target) continue
      if (matches.some(item => item.label === target.label)) throw new Error('history_audit_registry_ambiguous')
      matches.push({ label: target.label, role: target.role, id: user.id })
    }
  }
  throw new Error('history_audit_registry_incomplete')
}

async function boundedJson(url, headers) {
  const response = await fetch(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('history_audit_source_unavailable')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 5 * 1024 * 1024) throw new Error('history_audit_source_too_large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function readHistoryPages(readPage, maximum) {
  const rows = []
  const seen = new Set()
  for (let page = 0; page < 20; page++) {
    const batch = requireBound(await readPage(rows.length), 1000)
    if (batch.length === 0) return rows
    for (const row of batch) {
      if (!uuid.test(row?.id ?? '') || seen.has(row.id)) throw new Error('history_audit_source_scope_invalid')
      seen.add(row.id)
      rows.push(row)
    }
    requireBound(rows, maximum)
  }
  throw new Error('history_audit_source_incomplete')
}

async function readLegacy(project, token, targets) {
  const keys = await boundedJson(`https://api.supabase.com/v1/projects/${project}/api-keys`, { Authorization: `Bearer ${token}` })
  const key = requireBound(keys, 20).find(item => item.name === 'service_role')?.api_key
  if (typeof key !== 'string' || key.length < 20) throw new Error('history_audit_source_credential_missing')
  const headers = { Authorization: `Bearer ${key}`, apikey: key }
  const base = `https://${project}.supabase.co`
  const profiles = await readHistoryRegistry(page => boundedJson(`${base}/auth/v1/admin/users?page=${page}&per_page=1000`, headers), targets)
  const clientIds = profiles.filter(item => item.role === 'client').map(item => item.id)
  const cards = clientIds.length ? await readHistoryPages(offset => boundedJson(`${base}/rest/v1/clients?select=id,auth_user_id,trainer_id,archived_at&auth_user_id=in.(${clientIds.join(',')})&order=id&limit=51&offset=${offset}`, headers), 50) : []
  if (cards.some(card => !uuid.test(card.id) || !clientIds.includes(card.auth_user_id))) throw new Error('history_audit_source_scope_invalid')
  const workouts = cards.length ? await readHistoryPages(offset => boundedJson(`${base}/rest/v1/workouts?select=id,client_id,trainer_id,created_by,status,deleted_at,workout_date&client_id=in.(${cards.map(card => card.id).join(',')})&order=id&limit=1000&offset=${offset}`, headers), 5000) : []
  if (workouts.some(workout => !uuid.test(workout.id) || !cards.some(card => card.id === workout.client_id))) throw new Error('history_audit_source_scope_invalid')
  return { profiles, cards, workouts }
}

export function summarizeHistory(legacy, current, visibility) {
  const profileLabels = new Map(legacy.profiles.map(profile => [profile.id, profile.label]))
  if (current.evidence && !profileLabels.has(current.evidence.profileId)) profileLabels.set(current.evidence.profileId, 'athleteCurrent')
  const cardLabels = new Map(current.cards.map((card, index) => [card.id, `card${index + 1}`]))
  const currentIds = new Set(current.workouts.map(workout => workout.id))
  const legacyIds = new Set(legacy.workouts.map(workout => workout.id))
  const profiles = Object.entries(historyTargetRoles).map(([label, role]) => {
    const target = { label, role }
    const resolved = legacy.profiles.find(profile => profile.label === target.label)
    const stored = current.profiles.find(profile => profile.id === resolved?.id)
    return { account: target.label, registryMatched: Boolean(resolved), currentProfileFound: resolved ? Boolean(stored) : null,
      roleMatches: stored ? stored.account_role === target.role : null,
      identityLinked: stored?.identity_linked ?? null, identityOrigin: stored?.identity_origin ?? null }
  })
  const summarize = rows => {
    const groups = new Map()
    for (const row of rows) {
      const card = cardLabels.get(row.client_id) ?? 'outsideResolvedCards'
      const author = profileLabels.get(row.created_by) ?? (row.created_by === null ? 'legacyNullAuthor' : 'otherProfile')
      const key = JSON.stringify([card, author, row.status, Boolean(row.deleted_at)])
      const group = groups.get(key) ?? { card, author, status: row.status, deleted: Boolean(row.deleted_at), count: 0 }
      group.count++
      groups.set(key, group)
    }
    return [...groups.values()]
  }
  const evidenceProfile = current.profiles.find(profile => profile.id === current.evidence?.profileId)
  return { event: 'account_history_readonly_audit', readOnly: true, profiles,
    currentEvidence: current.evidence ? { sources: current.evidence.kinds,
      sameAsLegacyAthlete: legacy.profiles.some(profile => profile.role === 'client' && profile.id === current.evidence.profileId),
      currentProfileFound: Boolean(evidenceProfile), identityLinked: evidenceProfile?.identity_linked ?? null,
      identityOrigin: evidenceProfile?.identity_origin ?? null } : null,
    legacyWorkouts: summarize(legacy.workouts), currentWorkouts: summarize(current.workouts),
    legacyWorkoutIdsMissingNow: legacy.workouts.filter(workout => !currentIds.has(workout.id)).length,
    legacyWorkoutsSoftDeletedNow: current.workouts.filter(workout => legacyIds.has(workout.id) && workout.deleted_at).length,
    cards: current.cards.map(card => ({ card: cardLabels.get(card.id), archived: Boolean(card.archived_at),
      mergedInto: card.merged_into_client_id ? cardLabels.get(card.merged_into_client_id) ?? 'outsideResolvedCards' : null,
      owner: profileLabels.get(card.auth_user_id) ?? (card.auth_user_id ? 'otherProfile' : 'unclaimed'),
      historicalPartition: profileLabels.get(card.trainer_id) ?? 'otherProfile' })),
    relationships: current.relationships.map(row => ({ card: cardLabels.get(row.client_id),
      trainer: profileLabels.get(row.trainer_id) ?? 'otherProfile', status: row.status,
      disconnected: Boolean(row.disconnected_at),
      disconnectedBy: row.disconnected_by ? profileLabels.get(row.disconnected_by) ?? 'otherProfile' : null })),
    merges: current.merges.map(row => ({ source: cardLabels.get(row.source_client_id) ?? 'outsideResolvedCards',
      target: cardLabels.get(row.target_client_id) ?? 'outsideResolvedCards', status: row.status, completed: Boolean(row.completed_at) })),
    visibility,
    limitation: 'Email is not stored in native profiles; an unmatched registry address does not prove a native account is absent.',
  }
}

export async function inspectCurrentHistory(client, legacy, options = {}) {
  await client.query('begin transaction isolation level repeatable read read only')
  try {
    await client.query("set local statement_timeout = '10s'")
    await client.query("set local lock_timeout = '2s'")
    const state = await client.query("select current_setting('transaction_read_only') as readonly")
    if (state.rows[0]?.readonly !== 'on') throw new Error('history_audit_readonly_required')
    const evidence = await resolveHistoryEvidence(client, options.evidence)
    const auditProfiles = [...legacy.profiles]
    if (evidence && !auditProfiles.some(profile => profile.id === evidence.profileId)) {
      auditProfiles.push({ id: evidence.profileId, label: 'athleteCurrent', role: 'client' })
    }
    const ids = [...new Set(auditProfiles.map(profile => profile.id))]
    const clients = auditProfiles.filter(profile => profile.role === 'client').map(profile => profile.id)
    const profiles = (await client.query(`select p.id, p.account_role, exists(select 1 from app_private.auth_identities i
      where i.profile_id = p.id and i.provider = 'yandex') identity_linked,
      (select i.identity_origin from app_private.auth_identities i where i.profile_id = p.id and i.provider = 'yandex') identity_origin
      from public.profiles p where p.id = any($1::uuid[])`, [ids])).rows
    const cards = requireBound((await client.query(`with recursive scope as (
      select c.id, c.merged_into_client_id, array[c.id] path from public.clients c
      where c.auth_user_id = any($1::uuid[]) or c.id = any($2::uuid[])
      union all select c.id, c.merged_into_client_id, s.path || c.id from scope s
      join public.clients c on (c.id = s.merged_into_client_id or c.merged_into_client_id = s.id)
      where not c.id = any(s.path) and cardinality(s.path) < 20
      ) select distinct c.id, c.auth_user_id, c.trainer_id, c.archived_at, c.merged_into_client_id
      , (select max(cardinality(path)) >= 20 from scope) depth_limit_hit
      from public.clients c join scope s on s.id = c.id order by c.id limit 51`, [clients, legacy.cards.map(card => card.id)])).rows, 50)
    if (cards.some(card => card.depth_limit_hit)) throw new Error('history_audit_scope_exceeded')
    const cardIds = cards.map(card => card.id)
    const workouts = requireBound((await client.query(`select id, client_id, trainer_id, created_by, status, deleted_at, workout_date::text
      from public.workouts where client_id = any($1::uuid[]) or id = any($2::uuid[]) order by id limit 5001`,
    [cardIds, legacy.workouts.map(workout => workout.id)])).rows, 5000)
    const relationships = requireBound((await client.query(`select client_id, trainer_id, status, connected_at, disconnected_at, disconnected_by
      from public.client_trainer_relationships where client_id = any($1::uuid[]) order by client_id, connected_at limit 101`, [cardIds])).rows, 100)
    const merges = requireBound((await client.query(`select source_client_id, target_client_id, status, completed_at
      from public.client_merge_operations where source_client_id = any($1::uuid[]) or target_client_id = any($1::uuid[])
      order by created_at limit 101`, [cardIds])).rows, 100)
    const visibility = []
    for (const profile of auditProfiles.filter(item => profiles.some(stored => stored.id === item.id && stored.account_role === item.role))) {
      if (options.runtimeClient) {
        visibility.push({ account: profile.label, readableWorkouts: await readHistoryVisibility(options.runtimeClient, profile.id, workouts.map(workout => workout.id)) })
        continue
      }
      await client.query('savepoint visibility_probe')
      try {
        await client.query('set local role fit_api')
        await client.query("select set_config('request.jwt.claim.sub', $1, true)", [profile.id])
        const result = await client.query('select count(*)::integer count from public.workouts where id = any($1::uuid[])', [workouts.map(workout => workout.id)])
        visibility.push({ account: profile.label, readableWorkouts: result.rows[0].count })
      } catch (error) {
        if (error.code !== '42501') throw error
        visibility.push({ account: profile.label, probeUnavailable: 'role_permission_denied' })
      } finally {
        await client.query('rollback to savepoint visibility_probe')
        await client.query('release savepoint visibility_probe')
      }
    }
    await client.query('commit')
    return summarizeHistory(legacy, { profiles, cards, workouts, relationships, merges, evidence }, visibility)
  } catch (error) { await client.query('rollback'); throw error }
}

export function readWorkoutHistoryTarget(raw) {
  let target
  try { target = JSON.parse(raw) } catch { throw new Error('workout_history_target_invalid') }
  if (!target || Object.keys(target).sort().join(',') !== 'clientNameSha256,trainerEmailSha256,trainerLoginSha256'
    || ![target.clientNameSha256, target.trainerEmailSha256, target.trainerLoginSha256].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) {
    throw new Error('workout_history_target_invalid')
  }
  return target
}

// Read-only preflight for one privately approved journal import. This operation
// does not return identities, contacts, workout contents or fingerprints.
export async function inspectWorkoutHistoryTarget(owner, runtime, target, legacyTrainerId = null) {
  let trainerId
  let retainedLoginBinding = false
  let yandexIdentityLinked = false
  await owner.query('begin transaction isolation level repeatable read read only')
  try {
    await owner.query("set local statement_timeout = '10s'")
    const mode = await owner.query("select current_setting('transaction_read_only') readonly")
    if (mode.rows[0]?.readonly !== 'on') throw new Error('history_audit_readonly_required')
    const candidates = requireBound((await owner.query(`select distinct profile_id from (
      select profile_id from app_private.fit_lime_pilot_allowlist where login_sha256=any($1::text[])
      union select profile_id from app_private.trainer_schedule_v2_allowlist where login_sha256=any($1::text[])
      union select profile_id from app_private.nutrition_native_bindings where login_sha256=any($1::text[])
      ) matched where profile_id is not null limit 3`, [[...new Set([target.trainerLoginSha256, target.trainerEmailSha256])]])).rows, 2)
    if (candidates.length > 1 || (legacyTrainerId && candidates.some(row => row.profile_id !== legacyTrainerId))) {
      throw new Error('workout_history_trainer_ambiguous')
    }
    retainedLoginBinding = candidates.length === 1
    trainerId = candidates[0]?.profile_id ?? legacyTrainerId
    if (!trainerId) {
      await owner.query('commit')
      return { event: 'workout_history_import_preflight', readOnly: true, trainerMatched: false, matchingCards: 0,
        limitation: 'A native profile outside retained login bindings cannot be resolved by email; no match does not prove account absence.' }
    }
    if (!uuid.test(trainerId)) throw new Error('workout_history_target_invalid')
    const profile = (await owner.query(`select account_role, exists (
      select 1 from app_private.auth_identities identity where identity.profile_id=public.profiles.id
      and identity.provider='yandex'
    ) yandex_linked from public.profiles where id=$1`, [trainerId])).rows
    if (profile.length !== 1 || profile[0].account_role !== 'trainer') throw new Error('workout_history_trainer_role_invalid')
    yandexIdentityLinked = profile[0].yandex_linked === true
    await owner.query('commit')
  } catch (error) { await owner.query('rollback'); throw error }
  await runtime.query('begin transaction isolation level repeatable read read only')
  try {
    await runtime.query("set local statement_timeout = '10s'")
    const role = (await runtime.query(`select current_setting('transaction_read_only') readonly,
      current_user name, rolsuper, rolbypassrls from pg_roles where rolname=current_user`)).rows[0]
    if (role?.readonly !== 'on' || role.name !== 'fit_api' || role.rolsuper !== false || role.rolbypassrls !== false) {
      throw new Error('history_audit_runtime_role_invalid')
    }
    await runtime.query("select set_config('request.jwt.claim.sub', $1, true)", [trainerId])
    const cards = requireBound((await runtime.query(`select c.id, c.auth_user_id,
      c.archived_at is not null archived, c.merged_into_client_id is not null merged
      from public.clients c left join public.client_trainers ct on ct.client_id=c.id and ct.trainer_id=$1
      where (c.trainer_id=$1 or ct.trainer_id=$1 or exists (
        select 1 from public.client_trainer_relationships relationship
        where relationship.client_id=c.id and relationship.trainer_id=$1 and relationship.status='active'
      )) and (
        encode(sha256(convert_to(lower(btrim(c.full_name)), 'UTF8')), 'hex')=$2
        or encode(sha256(convert_to(lower(btrim(ct.alias)), 'UTF8')), 'hex')=$2
        or encode(sha256(convert_to(split_part(lower(btrim(c.full_name)), ' ', 1), 'UTF8')), 'hex')=$2
        or encode(sha256(convert_to(split_part(lower(btrim(ct.alias)), ' ', 1), 'UTF8')), 'hex')=$2
      ) order by c.id limit 11`, [trainerId, target.clientNameSha256])).rows, 10)
    const active = cards.filter(card => !card.archived && !card.merged)
    const counts = active.length === 1 ? (await runtime.query(`select status, deleted_at is not null deleted,
      count(*)::integer count from public.workouts where client_id=$1 group by status, deleted_at is not null`, [active[0].id])).rows : []
    await runtime.query('commit')
    return { event: 'workout_history_import_preflight', readOnly: true, trainerMatched: true, retainedLoginBinding, yandexIdentityLinked,
      matchingCards: cards.length, activeMatchingCards: active.length,
      athleteLinked: active.length === 1 ? Boolean(active[0].auth_user_id) : null, existingWorkouts: counts }
  } catch (error) { await runtime.query('rollback'); throw error }
}

async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'podkolzinpd/fit') throw new Error('history_audit_target_invalid')
  const { buildDatabaseConnectionConfig } = await import('/app/dist/db/connection-config.js')
  const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
  const runtimeConfig = buildDatabaseConnectionConfig('DATABASE')
  if (config?.host !== '10.70.10.67' || config.port !== 5432 || config.database !== 'fit' || config.user !== 'fit_owner'
    || process.env.MIGRATION_DATABASE_SSL_MODE !== 'require') throw new Error('history_audit_target_invalid')
  if (runtimeConfig?.host !== '10.70.10.67' || runtimeConfig.port !== 5432 || runtimeConfig.database !== 'fit'
    || runtimeConfig.user !== 'fit_api' || process.env.DATABASE_SSL_MODE !== 'require') throw new Error('history_audit_runtime_role_invalid')
  const project = process.env.SUPABASE_PROJECT_ID ?? ''
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!/^[a-z0-9]{20}$/.test(project) || !token) throw new Error('history_audit_source_config_missing')
  const importTarget = process.env.FIT_WORKOUT_HISTORY_TARGET
    ? readWorkoutHistoryTarget(process.env.FIT_WORKOUT_HISTORY_TARGET) : null
  const targets = importTarget ? [{ emailHash: importTarget.trainerEmailSha256, label: 'importTrainer', role: 'trainer' }]
    : readHistoryTargets(process.env.FIT_ACCOUNT_HISTORY_TARGETS)
  const legacy = await readLegacy(project, token, targets)
  const { Client } = createRequire('/app/package.json')('pg')
  const client = new Client({ ...config, connectionTimeoutMillis: 5000, query_timeout: 15000 })
  const runtimeClient = new Client({ ...runtimeConfig, connectionTimeoutMillis: 5000, query_timeout: 15000 })
  await client.connect()
  try {
    await runtimeClient.connect()
    console.log(JSON.stringify(importTarget
      ? await inspectWorkoutHistoryTarget(client, runtimeClient, importTarget, legacy.profiles[0]?.id ?? null)
      : await inspectCurrentHistory(client, legacy, {
        evidence: readHistoryEvidenceSecret(process.env.FIT_ACCOUNT_HISTORY_EVIDENCE), runtimeClient,
      })))
  } finally { await Promise.all([client.end(), runtimeClient.end()]) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const known = new Set(['history_audit_target_invalid', 'history_audit_targets_invalid', 'history_audit_source_config_missing',
      'history_audit_readonly_required', 'history_audit_source_credential_missing', 'history_audit_scope_exceeded',
      'history_audit_registry_invalid', 'history_audit_registry_ambiguous', 'history_audit_registry_incomplete',
      'history_audit_source_scope_invalid', 'history_audit_source_unavailable', 'history_audit_source_too_large',
      'history_audit_source_incomplete', 'history_audit_runtime_role_invalid', 'history_audit_evidence_invalid',
      'history_audit_evidence_not_found', 'history_audit_evidence_feedback_mismatch',
      'history_audit_evidence_role_mismatch', 'history_audit_evidence_ambiguous',
      'workout_history_target_invalid', 'workout_history_trainer_ambiguous', 'workout_history_trainer_role_invalid'])
    const safe = known.has(error?.message) ? error.message : 'history_audit_failed'
    console.error(safe)
    process.exitCode = 1
  })
}
