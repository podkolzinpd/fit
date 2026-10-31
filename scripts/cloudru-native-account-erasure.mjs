import { createHash } from 'node:crypto'
import { resolveHistoryEvidence } from './cloudru-account-history-audit.mjs'
import { readDeletionScope } from './cloudru-account-deletion.mjs'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const sha = value => createHash('sha256').update(value).digest('hex')
const quote = value => '"' + value.replaceAll('"', '""') + '"'
const count = async (db, sql, values) => Number((await db.query(sql, values)).rows[0].n)
const bounded = (rows, maximum) => {
  if (rows.length > maximum) throw Error('erasure_scope_exceeded')
  return rows
}
const featureBindings = ['assistant_feature_links_pilot_allowlist', 'client_lime_pilot_allowlist',
  'fit_lime_pilot_allowlist', 'trainer_schedule_v2_allowlist']

export function approvedErasureScope(raw) {
  const scope = readDeletionScope(raw)
  if (!scope.evidence) throw Error('erasure_feedback_required')
  return { ...scope, fingerprint: sha(JSON.stringify(scope)) }
}

// A receipt is private recovery state, never a public result or a source of a new target.
export function validateErasureReceipt(value, scope) {
  if (!value || value.version !== 1 || value.scope !== scope.fingerprint || !uuid.test(value.profileId)
    || !['prepared', 'committed'].includes(value.phase)
    || !['cards', 'workouts', 'exercises', 'sets', 'conversations', 'messages', 'meetings', 'outbox'].every(key =>
      Array.isArray(value[key]) && value[key].length <= 100000 && value[key].every(id => uuid.test(id)))
    || !Array.isArray(value.subjects) || value.subjects.length !== 1
    || !/^[a-f0-9]{64}$/.test(value.subjects[0])) throw Error('erasure_receipt_invalid')
  return value
}

async function ownerGate(db, readOnly) {
  await db.query("set local statement_timeout='15s'")
  await db.query("set local lock_timeout='3s'")
  const row = (await db.query("select current_user username,current_setting('transaction_read_only') readonly")).rows[0]
  if (row.username !== 'fit_owner' || row.readonly !== (readOnly ? 'on' : 'off')) throw Error('erasure_owner_required')
}

async function prepare(db, scope, readOnly) {
  const evidence = await resolveHistoryEvidence(db, scope.evidence)
  if (!evidence?.kinds.includes('feedback')) throw Error('erasure_feedback_required')
  const profileId = evidence.profileId
  const profiles = (await db.query(`select account_role from public.profiles where id=$1 ${readOnly ? '' : 'for update'}`, [profileId])).rows
  const identities = (await db.query(`select provider,provider_subject_sha256,identity_origin from app_private.auth_identities where profile_id=$1 ${readOnly ? '' : 'for update'}`, [profileId])).rows
  if (profiles.length !== 1 || profiles[0].account_role !== 'client' || identities.length !== 1
    || identities[0].provider !== 'yandex' || identities[0].identity_origin !== 'native') throw Error('erasure_native_client_required')
  const cards = bounded((await db.query(`select id,auth_user_id,merged_into_client_id from public.clients
    where auth_user_id=$1 or trainer_id=$1 ${readOnly ? '' : 'for update'}`, [profileId])).rows, 20)
  if (cards.some(card => card.auth_user_id !== profileId || card.merged_into_client_id)) throw Error('erasure_shared_card')
  const ids = cards.map(card => card.id)
  const p = [profileId, ids]
  const blockers = [
    ['privileged_profile', `select count(*) n from public.trainers where profile_id=$1`, [profileId]],
    ['privileged_profile', `select count(*) n from app_private.corporate_admins where profile_id=$1`, [profileId]],
    ['privileged_profile', `select count(*) n from app_private.corporate_admin_logins where subject_sha256=$1`, [identities[0].provider_subject_sha256]],
    ['merged_card', `select count(*) n from public.clients where merged_into_client_id=any($1::uuid[])`, [ids]],
    ['merged_card', `select count(*) n from public.client_merge_operations where actor_id=$1 or source_client_id=any($2::uuid[]) or target_client_id=any($2::uuid[])`, p],
    ['custom_exercise', `select count(*) n from public.custom_exercises where trainer_id=$1 or created_by=$1`, [profileId]],
    ['shared_chat', `select count(*) n from public.chat_conversations where client_user_id=$1 and not(client_id=any($2::uuid[])) or client_id=any($2::uuid[]) and client_user_id is distinct from $1`, p],
    ['shared_authorship', `select count(*) n from public.chat_messages m join public.chat_conversations c on c.id=m.conversation_id where m.sender_id=$1 and not(c.client_id=any($2::uuid[]))`, p],
    ['shared_authorship', `select count(*) n from public.client_invitations where created_by=$1 and not(client_id=any($2::uuid[]))`, p],
    ['shared_authorship', `select count(*) n from public.client_trainer_relationships where (connected_by=$1 or disconnected_by=$1) and not(client_id=any($2::uuid[]))`, p],
    ['shared_authorship', `select count(*) n from private.assistant_program_generations where owner_id=$1 and not(client_id=any($2::uuid[]))`, p],
  ]
  for (const table of ['client_progress', 'client_custom_metrics', 'client_goals', 'goal_stages', 'goal_criteria']) {
    blockers.push(['shared_authorship', `select count(*) n from public.${table} where (created_by=$1${table === 'goal_criteria' ? ' or confirmed_by=$1' : ''}) and not(client_id=any($2::uuid[]))`, p])
  }
  for (const table of ['trainer_finance_packages', 'trainer_finance_payments', 'trainer_finance_sessions', 'trainer_finance_events']) {
    blockers.push(['financial_records', `select count(*) n from public.${table} where client_id=any($1::uuid[])`, [ids]])
  }
  for (const table of ['finance_manual_requests', 'finance_payment_requests']) {
    blockers.push(['financial_records', `select count(*) n from app_private.${table} where actor_id=$1 or payload->>'clientId'=any($2::text[])`, p])
  }
  for (const [reason, sql, values] of blockers) if (await count(db, sql, values)) throw Error(`erasure_review_${reason}`)
  const selectIds = async (table, predicate, values, limit) => bounded((await db.query(
    `select id from public.${table} where ${predicate} limit ${limit + 1} ${readOnly ? '' : 'for update'}`, values)).rows, limit).map(row => row.id)
  const workouts = await selectIds('workouts', 'client_id=any($1::uuid[])', [ids], 10000)
  const exercises = await selectIds('workout_exercises', 'workout_id=any($1::uuid[])', [workouts], 100000)
  const sets = await selectIds('workout_sets', 'workout_exercise_id=any($1::uuid[])', [exercises], 100000)
  const conversations = await selectIds('chat_conversations', 'client_id=any($1::uuid[])', [ids], 100)
  const messages = await selectIds('chat_messages', 'conversation_id=any($1::uuid[])', [conversations], 100000)
  const meetings = await selectIds('chat_meetings', 'conversation_id=any($1::uuid[])', [conversations], 10000)
  if (await count(db, 'select count(*) n from public.chat_messages where id=any($1::uuid[]) and image_path is not null', [messages])) throw Error('erasure_review_media')
  if (await count(db, `select count(*) n from public.chat_meeting_sessions where meeting_id=any($1::uuid[]) and expires_at>now()`, [meetings])) throw Error('erasure_review_active_meeting')
  const related = [profileId, ...ids, ...workouts, ...conversations, ...messages, ...meetings]
  const pushes = bounded((await db.query(`select id,dispatch_started_at,sent_at from app_private.push_notifications_outbox o
    where user_id=$1 or exists(select 1 from jsonb_each_text(o.data) d
      where d.key in('user_id','client_id','workout_id','conversation_id','message_id','meeting_id') and d.value=any($2::text[]))
    limit 100001 ${readOnly ? '' : 'for update'}`, [profileId, related])).rows, 100000)
  if (pushes.some(row => row.dispatch_started_at && !row.sent_at)) throw Error('erasure_review_inflight_push')
  return { version: 1, phase: 'prepared', scope: scope.fingerprint, profileId, cards: ids, workouts, exercises, sets, conversations,
    messages, meetings, outbox: pushes.map(row => row.id), subjects: [identities[0].provider_subject_sha256] }
}

async function erase(db, receipt) {
  const { profileId: id, cards, workouts, exercises, sets, conversations, outbox, subjects } = receipt
  await db.query('delete from app_private.live_workout_operations where actor_id=$1 or resource_id=any($2::uuid[])', [id, [...workouts, ...exercises, ...sets]])
  await db.query('delete from app_private.push_notifications_outbox where id=any($1::uuid[])', [outbox])
  await db.query('delete from public.chat_conversations where id=any($1::uuid[])', [conversations])
  // Goals own stages/criteria. Remove them before progress/metrics referenced by criteria.
  await db.query('delete from public.client_goals where client_id=any($1::uuid[])', [cards])
  await db.query('delete from public.client_progress where client_id=any($1::uuid[])', [cards])
  await db.query('delete from public.client_custom_metrics where client_id=any($1::uuid[])', [cards])
  await db.query('delete from app_private.fit_lime_calendar_workouts where workout_id=any($1::uuid[])', [workouts])
  const removedWorkouts = await db.query('delete from public.workouts where id=any($1::uuid[])', [workouts])
  if (removedWorkouts.rowCount !== workouts.length) throw Error('erasure_row_count')
  await db.query('delete from public.client_trainer_relationships where client_id=any($1::uuid[])', [cards])
  await db.query('delete from app_private.fit_lime_calendar_clients where client_id=any($1::uuid[])', [cards])
  const removedCards = await db.query('delete from public.clients where id=any($1::uuid[]) and auth_user_id=$2', [cards, id])
  if (removedCards.rowCount !== cards.length) throw Error('erasure_row_count')
  for (const table of featureBindings) await db.query(`delete from app_private.${table} where profile_id=$1`, [id])
  await db.query('delete from app_private.yandex_auth_handoffs where subject_sha256=any($1::text[])', [subjects])
  const removedProfile = await db.query('delete from public.profiles where id=$1 and account_role=\'client\'', [id])
  if (removedProfile.rowCount !== 1) throw Error('erasure_row_count')
  await db.query('set constraints all immediate')
}

async function verify(db, receipt) {
  const { profileId, cards, workouts, exercises, sets, conversations, messages, meetings, outbox, subjects } = receipt
  const targets = [ ['public', 'profiles', [profileId]], ['public', 'clients', cards], ['public', 'workouts', workouts],
    ['public', 'chat_conversations', conversations], ['public', 'chat_messages', messages], ['public', 'chat_meetings', meetings],
    ['public', 'workout_exercises', exercises], ['public', 'workout_sets', sets], ['app_private', 'push_notifications_outbox', outbox] ]
  for (const [schema, table, ids] of targets) {
    if (await count(db, `select count(*) n from ${schema}.${table} where id=any($1::uuid[])`, [ids])) throw Error('erasure_readback_failed')
  }
  const related = [profileId, ...cards, ...workouts, ...conversations, ...messages, ...meetings]
  if (await count(db, `select count(*) n from app_private.push_notifications_outbox o where user_id=$1
    or exists(select 1 from jsonb_each_text(o.data) d where d.key in('user_id','client_id','workout_id','conversation_id','message_id','meeting_id') and d.value=any($2::text[]))`,
  [profileId, related])) throw Error('erasure_readback_failed')
  if (await count(db, 'select count(*) n from app_private.yandex_auth_handoffs where subject_sha256=any($1::text[])', [subjects])) throw Error('erasure_readback_failed')
  if (await count(db, 'select count(*) n from app_private.live_workout_operations where actor_id=$1 or resource_id=any($2::uuid[])', [profileId, [...workouts, ...exercises, ...sets]])) throw Error('erasure_readback_failed')
  // Check every incoming FK, including SET NULL and future schema additions.
  const refs = (await db.query(`select n.nspname schema,c.relname table_name,a.attname column_name,rc.relname parent
    from pg_constraint f join pg_class c on c.oid=f.conrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_class rc on rc.oid=f.confrelid join pg_namespace rn on rn.oid=rc.relnamespace
    cross join lateral unnest(f.conkey,f.confkey) k(child,parent)
    join pg_attribute a on a.attrelid=c.oid and a.attnum=k.child
    join pg_attribute pa on pa.attrelid=rc.oid and pa.attnum=k.parent
    where f.contype='f' and rn.nspname='public' and rc.relname in('profiles','clients','workouts') and pa.attname='id'`)).rows
  for (const ref of refs) {
    const ids = ref.parent === 'profiles' ? [profileId] : ref.parent === 'clients' ? cards : workouts
    if (await count(db, `select count(*) n from ${quote(ref.schema)}.${quote(ref.table_name)} where ${quote(ref.column_name)}=any($1::uuid[])`, [ids])) throw Error('erasure_readback_failed')
  }
}

export async function runNativeErasure({ db, mode, rawScope, receipt, persistReceipt }) {
  if (!['inspect', 'apply', 'verify'].includes(mode)) throw Error('erasure_mode_invalid')
  const scope = approvedErasureScope(rawScope)
  if (mode === 'apply' && typeof persistReceipt !== 'function') throw Error('erasure_receipt_required')
  const readOnly = mode !== 'apply'
  await db.query(readOnly ? 'begin isolation level repeatable read read only' : 'begin isolation level serializable')
  let commitAttempted = false
  let prepared
  try {
    await ownerGate(db, readOnly)
    if (mode === 'verify') {
      prepared = validateErasureReceipt(receipt, scope)
      await verify(db, prepared)
    } else {
      prepared = await prepare(db, scope, readOnly)
      if (mode === 'apply') {
        await persistReceipt(prepared)
        await erase(db, prepared)
        await verify(db, prepared)
      }
    }
    commitAttempted = true
    await db.query('commit')
  } catch (error) {
    if (commitAttempted && mode === 'apply') throw Error('erasure_outcome_unknown')
    await db.query('rollback')
    throw error
  }
  if (mode === 'apply') {
    // Persist before separate readback; a lost COMMIT response can be resolved in verify mode.
    await persistReceipt({ ...prepared, phase: 'committed' })
    await db.query('begin isolation level repeatable read read only')
    try { await ownerGate(db, true); await verify(db, prepared); await db.query('commit') }
    catch { await db.query('rollback'); throw Error('erasure_committed_readback_failed') }
  }
  return { event: 'native_account_erasure', status: mode === 'inspect' ? 'ready' : 'deleted_verified',
    readOnly, accountDeleted: mode !== 'inspect', cards: prepared.cards.length, workouts: prepared.workouts.length,
    conversations: prepared.conversations.length, media: 0, legacyMutated: false }
}
