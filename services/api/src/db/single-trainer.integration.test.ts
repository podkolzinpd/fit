import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readdir } from 'node:fs/promises'
import { runner } from 'node-pg-migrate'
import { Pool, type QueryResultRow } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseClient } from './types.js'
import type { PlannedWorkoutDraft } from '../planned-workout-request.js'
import { confirmLiveSet, finishLiveWorkout, saveCompletedWorkout, savePlannedWorkout, startLiveWorkout } from '../workout-commands.js'
import { readAccessibleTrainingData } from '../training-data.js'

const source = process.env.TEST_DATABASE_URL
const database = `fit_single_trainer_${process.pid}`
const directory = fileURLToPath(new URL('../../db/migrations', import.meta.url))

// These are new regressions, not another theme/viewport matrix: real RLS,
// different command entry points, contention, and historical data preservation.
describe.skipIf(source === undefined)('one active trainer through every connection command', () => {
  let admin: Pool
  let pool: Pool
  let created = false
  let upgradeCreated = false
  const upgradeDatabase = `${database}_upgrade`

  beforeAll(async () => {
    const url = new URL(source ?? '')
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/fit_actor_test') {
      throw new Error('local_fit_actor_test_database_required')
    }
    admin = new Pool({ connectionString: url.href, max: 1 })
    await admin.query(`create database ${database}`)
    created = true
    url.pathname = `/${database}`
    await runner({ databaseUrl: url.href, dir: directory, direction: 'up',
      migrationsTable: 'fit_migrations', migrationsSchema: 'app_private',
      createMigrationsSchema: true, verbose: false, log: () => {} })
    pool = new Pool({ connectionString: url.href, max: 4 })
  })

  afterAll(async () => {
    if (pool) await pool.end()
    if (created) await admin.query(`drop database ${database}`)
    if (upgradeCreated) await admin.query(`drop database ${upgradeDatabase}`)
    if (admin) await admin.end()
  })

  async function command<Result>(id: string, work: (client: DatabaseClient) => Promise<Result>) {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [id])
      await client.query('set local role fit_api')
      const result = await work({ query: async <Row extends QueryResultRow>(sql: string, values?: readonly unknown[]) =>
        (await client.query<Row>(sql, values ? [...values] : undefined)).rows })
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally { client.release() }
  }

  const actor = <Row extends QueryResultRow = QueryResultRow>(id: string, sql: string, values: readonly unknown[] = []) =>
    command(id, client => client.query<Row>(sql, values))

  async function fixture() {
    const athlete = randomUUID(), first = randomUUID(), second = randomUUID(), outsider = randomUUID(), card = randomUUID()
    await pool.query(`insert into public.profiles(id, first_name, account_role)
      values ($1,'Synthetic athlete','client'), ($2,'Synthetic first','trainer'),
        ($3,'Synthetic second','trainer'), ($4,'Synthetic outside','trainer')`, [athlete, first, second, outsider])
    await pool.query('insert into public.trainers(profile_id) values ($1), ($2), ($3)', [first, second, outsider])
    await pool.query(`insert into public.clients(id, trainer_id, auth_user_id, full_name)
      values ($1,$2,$2,'Synthetic own card')`, [card, athlete])
    return { athlete, first, second, outsider, card }
  }

  async function offer(athlete: string, card: string) {
    const [row] = await actor<{ invitation_code: string; invitation_token: string }>(athlete,
      "select * from public.create_client_invitation_share($1, 'trainer')", [card])
    if (!row) throw new Error('fixture_offer_missing')
    return row
  }

  async function counts(card: string) {
    return (await pool.query<{ active: number; memberships: number }>(`select
      (select count(*)::int from public.client_trainer_relationships where client_id=$1 and status='active') active,
      (select count(*)::int from public.client_trainers where client_id=$1) memberships`, [card])).rows[0]
  }

  it('never grants a second membership current access, and does not require a membership for the active trainer', async () => {
    const f = await fixture()
    await pool.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)', [f.card, f.first, f.athlete])
    await pool.query("insert into public.client_trainers(client_id,trainer_id,note) values($1,$2,'private old note')", [f.card, f.second])
    await pool.query('insert into public.client_progress(client_id,trainer_id,created_by,recorded_on,weight_kg) values($1,$2,$2,current_date,70)', [f.card, f.athlete])
    expect(await actor(f.second, 'select public.can_access_client($1) allowed', [f.card])).toEqual([{ allowed: false }])
    expect(await actor(f.second, 'select id from public.client_progress where client_id=$1', [f.card])).toEqual([])
    expect(await actor(f.first, 'select public.can_access_client($1) allowed', [f.card])).toEqual([{ allowed: true }])
    expect(await actor(f.first, 'select note from public.client_trainers where client_id=$1', [f.card])).toEqual([])
    await expect(actor(f.second, 'select * from public.quick_start_live_workout($1,$2)', [f.card, randomUUID()])).rejects.toMatchObject({ message: 'client_forbidden' })
    expect(await actor(f.athlete, 'select trainer_id from public.list_accessible_client_trainers() where client_id=$1', [f.card])).toEqual([{ trainer_id: f.first }])
  })

  it.each(['code', 'link'] as const)('creates one period through %s, retries safely, and cannot resurrect a disconnected relationship', async (entry) => {
    const f = await fixture(), invitation = await offer(f.athlete, f.card)
    const sql = entry === 'code' ? 'select public.claim_client_invitation($1) id' : 'select public.claim_client_invitation_link($1) id'
    const token = entry === 'code' ? invitation.invitation_code : invitation.invitation_token
    expect(await actor(f.first, sql, [token])).toEqual([{ id: f.card }])
    expect(await actor(f.first, sql, [token])).toEqual([{ id: f.card }])
    expect(await counts(f.card)).toEqual({ active: 1, memberships: 1 })
    await expect(actor(f.athlete, "select * from public.create_client_invitation_share($1,'trainer')", [f.card])).rejects.toMatchObject({ message: 'trainer_disconnect_required' })
    await actor(f.athlete, 'select public.remove_client_trainer($1,$2)', [f.card, f.first])
    await actor(f.athlete, 'select public.remove_client_trainer($1,$2)', [f.card, f.first])
    await expect(actor(f.first, sql, [token])).rejects.toMatchObject({ message: 'invitation_connection_ended' })
    expect(await counts(f.card)).toEqual({ active: 0, memberships: 1 })
    const next = await offer(f.athlete, f.card)
    await actor(f.second, 'select public.claim_client_invitation_link($1)', [next.invitation_token])
    expect(await actor(f.athlete, 'select trainer_id from public.list_accessible_client_trainers() where client_id=$1', [f.card])).toEqual([{ trainer_id: f.second }])
  })

  it('serializes a chat acceptance and a reverse link: exactly one wins, without partial membership', async () => {
    const f = await fixture(), invitation = await offer(f.athlete, f.card), chat = randomUUID()
    await pool.query('insert into public.chat_conversations(id,client_id,client_user_id,trainer_id) values($1,$2,$3,$4)', [chat, f.card, f.athlete, f.first])
    await actor(f.first, 'select * from public.send_chat_connection_invitation($1)', [chat])
    const results = await Promise.allSettled([
      actor(f.athlete, 'select * from public.accept_chat_connection_invitation($1)', [chat]),
      actor(f.second, 'select public.claim_client_invitation_link($1)', [invitation.invitation_token]),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
    expect(await counts(f.card)).toEqual({ active: 1, memberships: 1 })
  })

  it('requires a fresh chat offer after trainer disconnect; repeat acceptance alone never reconnects', async () => {
    const f = await fixture(), chat = randomUUID()
    await pool.query('insert into public.chat_conversations(id,client_id,client_user_id,trainer_id) values($1,$2,$3,$4)', [chat, f.card, f.athlete, f.first])
    await actor(f.first, 'select * from public.send_chat_connection_invitation($1)', [chat])
    await actor(f.athlete, 'select * from public.accept_chat_connection_invitation($1)', [chat])
    await pool.query("update public.client_trainers set note='kept private note' where client_id=$1", [f.card])
    await actor(f.first, 'select public.leave_client_space($1)', [f.card])
    await expect(actor(f.athlete, 'select * from public.accept_chat_connection_invitation($1)', [chat])).rejects.toMatchObject({ message: 'chat_invitation_required' })
    expect(await counts(f.card)).toEqual({ active: 0, memberships: 1 })
    const pending = await actor(f.first, 'select * from public.send_chat_connection_invitation($1)', [chat])
    expect(pending[0]).toMatchObject({ invitation_pending: true, active_connection: false })
    await actor(f.athlete, 'select * from public.accept_chat_connection_invitation($1)', [chat])
    expect(await counts(f.card)).toEqual({ active: 1, memberships: 1 })
    expect((await pool.query('select note from public.client_trainers where client_id=$1', [f.card])).rows).toEqual([{ note: 'kept private note' }])
  })

  it.each(['code', 'link'] as const)('merges a trainer plan through %s without losing own history, amounts or authorship', async (entry) => {
    const f = await fixture(), sourceCard = randomUUID(), ownWorkout = randomUUID(), plan = randomUUID(), sourceDone = randomUUID(), packageId = randomUUID()
    await pool.query("insert into public.clients(id,trainer_id,full_name) values($1,$2,'Synthetic trainer card')", [sourceCard, f.first])
    await pool.query('insert into public.client_trainers(client_id,trainer_id) values($1,$2)', [sourceCard, f.first])
    await pool.query(`insert into public.workouts(id,trainer_id,client_id,created_by,workout_date,status,started_at,completed_at)
      values($1,$2,$3,$2,current_date,'done',now()-interval '1 hour',now())`, [ownWorkout, f.athlete, f.card])
    await pool.query("insert into public.workouts(id,trainer_id,client_id,created_by,workout_date,status) values($1,$2,$3,$2,current_date,'planned')", [plan, f.first, sourceCard])
    await pool.query(`insert into public.trainer_finance_packages(id,trainer_id,client_id,title,sessions_total,price_cents,starts_on)
      values($1,$2,$3,'Synthetic package',10,123450,current_date)`, [packageId, f.first, sourceCard])
    await pool.query(`insert into public.trainer_finance_payments(package_id,trainer_id,client_id,amount_cents,received_on)
      values($1,$2,$3,12345,current_date)`, [packageId, f.first, sourceCard])
    await pool.query(`insert into public.workouts(id,trainer_id,client_id,created_by,workout_date,status,started_at,completed_at,training_format)
      values($1,$2,$3,$2,current_date,'done',now()-interval '1 hour',now(),'with_trainer')`, [sourceDone, f.first, sourceCard])
    const ownBefore = (await pool.query('select to_jsonb(workout) snapshot from public.workouts workout where id=$1', [ownWorkout])).rows
    const [invitation] = await actor(f.first, "select * from public.create_client_invitation_share($1,'client')", [sourceCard])
    if (!invitation) throw new Error('fixture_invitation_missing')
    const sql = entry === 'code' ? 'select public.claim_client_invitation($1) id' : 'select public.claim_client_invitation_link($1) id'
    const credential: unknown = entry === 'code' ? invitation.invitation_code : invitation.invitation_token
    expect(await actor(f.athlete, sql, [credential])).toEqual([{ id: f.card }])
    expect(await actor(f.athlete, sql, [credential])).toEqual([{ id: f.card }])
    expect((await pool.query('select to_jsonb(workout) snapshot from public.workouts workout where id=$1', [ownWorkout])).rows).toEqual(ownBefore)
    expect((await pool.query('select client_id,created_by from public.workouts where id=$1', [plan])).rows).toEqual([{ client_id: f.card, created_by: f.first }])
    expect((await pool.query('select client_id,trainer_id,amount_cents from public.trainer_finance_payments where package_id=$1', [packageId])).rows).toEqual([{ client_id: f.card, trainer_id: f.first, amount_cents: '12345' }])
    expect((await pool.query('select client_id,trainer_id,package_id,disposition from public.trainer_finance_sessions where workout_id=$1', [sourceDone])).rows)
      .toEqual([{ client_id: f.card, trainer_id: f.first, package_id: packageId, disposition: 'charged' }])
    await actor(f.first, 'select public.leave_client_space($1)', [f.card])
    expect(await actor(f.first, 'select id from public.workouts where id=$1', [ownWorkout])).toEqual([])
    expect(await actor(f.first, 'select id from public.workouts where id=$1', [plan])).toEqual([{ id: plan }])
    await expect(actor(f.first, 'select * from public.quick_start_live_workout($1,$2)', [f.card, randomUUID()])).rejects.toMatchObject({ message: 'client_forbidden' })
    expect(await actor(f.athlete, 'select id from public.workouts where client_id=$1 order by id', [f.card])).toHaveLength(3)
  })

  it('disconnects a historically trainer-owned partition without reparenting it, then connects another trainer', async () => {
    const f = await fixture()
    await pool.query('update public.clients set trainer_id=$2 where id=$1', [f.card, f.first])
    await pool.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)', [f.card, f.first, f.athlete])
    await actor(f.athlete, 'select public.remove_client_trainer($1,$2)', [f.card, f.first])
    const invitation = await offer(f.athlete, f.card)
    await actor(f.second, 'select public.claim_client_invitation_link($1)', [invitation.invitation_token])
    expect((await pool.query('select trainer_id,auth_user_id from public.clients where id=$1', [f.card])).rows).toEqual([{ trainer_id: f.first, auth_user_id: f.athlete }])
    expect(await actor(f.first, 'select public.can_access_client($1) allowed', [f.card])).toEqual([{ allowed: false }])
    expect(await actor(f.second, 'select public.can_access_client($1) allowed', [f.card])).toEqual([{ allowed: true }])
  })

  it.each(['code', 'link'] as const)('never transfers a formerly bound card to another athlete through %s', async entry => {
    const f = await fixture(), sourceCard = randomUUID()
    await pool.query("insert into public.clients(id,trainer_id,full_name) values($1,$2,'Synthetic former card')", [sourceCard, f.first])
    await pool.query(`insert into public.client_trainer_relationships(client_id,trainer_id,connected_by,status,disconnected_at,disconnected_by)
      values($1,$2,$2,'disconnected',now(),$2)`, [sourceCard, f.first])
    const [invitation] = await actor(f.first, "select * from public.create_client_invitation_share($1,'client')", [sourceCard])
    if (!invitation) throw new Error('fixture_invitation_missing')
    const before = (await pool.query('select to_jsonb(c) snapshot from public.clients c where id=$1', [sourceCard])).rows
    await expect(actor(f.athlete, entry === 'code' ? 'select public.claim_client_invitation($1)' : 'select public.claim_client_invitation_link($1)',
      [entry === 'code' ? invitation.invitation_code : invitation.invitation_token]))
      .rejects.toMatchObject({ message: 'client_merge_relationship_conflict' })
    expect((await pool.query('select to_jsonb(c) snapshot from public.clients c where id=$1', [sourceCard])).rows).toEqual(before)
    expect(await counts(f.card)).toEqual({ active: 0, memberships: 0 })
  })

  it('runs own history → coach plan → Live fact → disconnect → own training → new coach, preserving exact facts', async () => {
    const f = await fixture()
    const draft: PlannedWorkoutDraft = { id: null, requestId: randomUUID(), clientId: f.card,
      workoutDate: '2026-10-19', startTime: null, endTime: null, notes: 'Synthetic lifecycle', exercises: [{
        position: 0, source: 'system', ref: 'push-up', customExerciseId: null, name: 'Отжимания', muscleGroup: 'chest', inputKind: 'reps',
        blockId: randomUUID(), blockType: 'single', blockPreset: 'set', blockRounds: 1,
        restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0, trainerComment: null,
        sets: [{ position: 0, weightKg: null, reps: 10, durationMin: null, durationSec: null, distanceKm: null, rpe: null }],
      }] }
    const own = await command(f.athlete, db => saveCompletedWorkout(db, draft, null))
    const invitation = await offer(f.athlete, f.card)
    await actor(f.first, 'select public.claim_client_invitation_link($1)', [invitation.invitation_token])
    const plan = await command(f.first, db => savePlannedWorkout(db, { ...draft, requestId: randomUUID() }, null))
    const started = await command(f.athlete, db => startLiveWorkout(db, plan.id, plan.version, randomUUID()))
    const [set] = await actor<{ id: string; version: string }>(f.athlete, `select s.id,s.version from public.workout_sets s
      join public.workout_exercises e on e.id=s.workout_exercise_id where e.workout_id=$1`, [plan.id])
    if (!set) throw new Error('lifecycle_set_missing')
    await command(f.athlete, db => confirmLiveSet(db, set.id, Number(set.version), randomUUID()))
    const [workout] = await actor<{ version: string }>(f.athlete, 'select version from public.workouts where id=$1', [plan.id])
    if (!workout) throw new Error('lifecycle_workout_missing')
    expect(Number(workout.version)).toBeGreaterThanOrEqual(started.version)
    await command(f.athlete, db => finishLiveWorkout(db, plan.id, Number(workout.version), randomUUID()))
    const snapshot = async () => (await pool.query<{ workout: unknown; sets: unknown }>(`select to_jsonb(w) workout,
      (select jsonb_agg(to_jsonb(s) order by s.id) from public.workout_sets s
        join public.workout_exercises e on e.id=s.workout_exercise_id where e.workout_id=w.id) sets
      from public.workouts w where w.id=any($1::uuid[]) order by w.id`, [[own.id, plan.id]])).rows
    const facts = await snapshot()
    await actor(f.first, 'select public.leave_client_space($1)', [f.card])
    const ownAfter = await command(f.athlete, db => saveCompletedWorkout(db, { ...draft, requestId: randomUUID() }, null))
    const next = await offer(f.athlete, f.card)
    await actor(f.second, 'select public.claim_client_invitation($1)', [next.invitation_code])
    expect(await snapshot()).toEqual(facts)
    expect(await counts(f.card)).toEqual({ active: 1, memberships: 2 })
    const historical = await command(f.first, db => readAccessibleTrainingData(db, { limit: 50, offset: 0, scope: 'workouts' }))
    expect(historical.workouts.map(w => w.id)).toEqual([plan.id])
    expect(await actor(f.first, 'select id from public.workouts where id=$1', [ownAfter.id])).toEqual([])
  })

  it('uses the current coach for questions, attention and private preferences even on an athlete-owned partition', async () => {
    const f = await fixture(), invitation = await offer(f.athlete, f.card), workout = randomUUID()
    await actor(f.first, 'select public.claim_client_invitation_link($1)', [invitation.invitation_token])
    await pool.query(`insert into public.workouts(id,trainer_id,client_id,created_by,workout_date,status,completed_at)
      values($1,$2,$3,$2,current_date,'done',now())`, [workout, f.athlete, f.card])
    await actor(f.athlete, "select public.ask_workout_question($1,'Синтетический вопрос',1)", [workout])
    expect(await actor(f.first, 'select workout_id from public.list_trainer_attention_workouts() where workout_id=$1', [workout])).toEqual([{ workout_id: workout }])
    await actor(f.first, "select public.answer_workout_question($1,null,'Синтетический ответ',2)", [workout])
    await pool.query('delete from public.client_trainers where client_id=$1', [f.card])
    await actor(f.first, "select public.update_client_preferences($1,'Private alias','Private note',1)", [f.card])
    await actor(f.first, 'select public.snooze_client_attention($1)', [f.card])
    await actor(f.first, 'select public.leave_client_space($1)', [f.card])
    await expect(actor(f.first, 'select public.resolve_workout_question($1,3)', [workout])).rejects.toMatchObject({ message: 'workout_forbidden' })
    await expect(actor(f.first, "select public.update_client_preferences($1,'changed','changed',2)", [f.card])).rejects.toMatchObject({ message: 'client_forbidden' })
    await expect(actor(f.first, 'select public.snooze_client_attention($1)', [f.card])).rejects.toMatchObject({ message: 'client_forbidden' })
    expect(await actor(f.first, 'select workout_id from public.list_trainer_attention_workouts() where workout_id=$1', [workout])).toEqual([])
  })

  it('publishes through the active relationship, not the partition key, and refuses the former coach after disconnect', async () => {
    const f = await fixture(), invitation = await offer(f.athlete, f.card)
    await actor(f.first, 'select public.claim_client_invitation_link($1)', [invitation.invitation_token])
    const trainerSummary = { headline: 'Synthetic', progress: [], consistency: 'Synthetic', attention: [] }
    const clientSummary = { headline: 'Synthetic', achievements: [], consistency: 'Synthetic', encouragement: 'Synthetic', goalAlignment: 'Synthetic', nextSteps: [] }
    await actor(f.first, `select public.save_generated_training_summary($1,'2026-10-01','2026-10-19','Synthetic',
      $2::jsonb,$3::jsonb,'{}'::jsonb,'synthetic-model','synthetic-version',$4,'{}'::jsonb,'{}'::jsonb,now())`,
    [f.card, JSON.stringify(trainerSummary), JSON.stringify(clientSummary), 'a'.repeat(64)])
    const source = (await pool.query<{ id: string; version: string; trainer_id: string }>('select id,version,trainer_id from public.client_training_summaries where client_id=$1', [f.card])).rows[0]
    if (!source) throw new Error('summary_missing')
    expect(source.trainer_id).toBe(f.athlete)
    const published = await actor(f.first, 'select * from public.publish_training_summary($1,$2::jsonb,$3)', [source.id, JSON.stringify(clientSummary), source.version])
    expect(published).toHaveLength(1)
    const before = (await pool.query('select to_jsonb(p) snapshot from public.client_published_training_summaries p where client_id=$1', [f.card])).rows
    await actor(f.athlete, 'select public.remove_client_trainer($1,$2)', [f.card, f.first])
    await expect(actor(f.first, 'select public.unpublish_training_summary($1,$2)', [source.id, Number(source.version) + 1])).rejects.toMatchObject({ message: 'training_summary_conflict' })
    await expect(actor(f.first, 'select * from public.publish_training_summary($1,$2::jsonb,$3)', [source.id, JSON.stringify(clientSummary), Number(source.version) + 1])).rejects.toMatchObject({ message: 'training_summary_not_found' })
    expect((await pool.query('select to_jsonb(p) snapshot from public.client_published_training_summaries p where client_id=$1', [f.card])).rows).toEqual(before)
    expect(await actor(f.first, 'select id from public.client_training_summaries where client_id=$1', [f.card])).toEqual([])
  })

  it.each(['expired', 'revoked', 'archived', 'wrong-role', 'other-claimant'] as const)('rejects %s without a partial grant or changed history', async reason => {
    const f = await fixture(), invitation = await offer(f.athlete, f.card)
    if (reason === 'expired') await pool.query("update public.client_invitations set created_at=now()-interval '8 days', expires_at=now()-interval '1 minute' where client_id=$1", [f.card])
    if (reason === 'revoked') await pool.query('update public.client_invitations set revoked_at=now() where client_id=$1', [f.card])
    if (reason === 'archived') await pool.query('update public.clients set archived_at=now() where id=$1', [f.card])
    if (reason === 'other-claimant') await actor(f.first, 'select public.claim_client_invitation_link($1)', [invitation.invitation_token])
    const before = await counts(f.card)
    await expect(actor(reason === 'wrong-role' ? f.athlete : f.second,
      'select public.claim_client_invitation_link($1)', [invitation.invitation_token])).rejects.toMatchObject({
      message: reason === 'wrong-role' ? 'invitation_role_mismatch' : 'invitation_invalid',
    })
    expect(await counts(f.card)).toEqual(before)
  })

  it('blocks an ambiguous upgrade atomically; explicit resolution preserves both metadata rows and the partition', async () => {
    await admin.query(`create database ${upgradeDatabase}`)
    upgradeCreated = true
    const url = new URL(source ?? '')
    url.pathname = `/${upgradeDatabase}`
    const settings = { databaseUrl: url.href, dir: directory, direction: 'up' as const,
      migrationsTable: 'fit_migrations', migrationsSchema: 'app_private', createMigrationsSchema: true, verbose: false, log: () => {} }
    const count = (await readdir(directory)).filter(name => name.endsWith('.sql') && name < '000149').length
    await runner({ ...settings, count })
    const upgrade = new Pool({ connectionString: url.href, max: 1 })
    try {
      const athlete = randomUUID(), first = randomUUID(), second = randomUUID(), card = randomUUID()
      await upgrade.query("insert into public.profiles(id,account_role) values($1,'client'),($2,'trainer'),($3,'trainer')", [athlete, first, second])
      await upgrade.query('insert into public.trainers(profile_id) values($1),($2)', [first, second])
      await upgrade.query("insert into public.clients(id,trainer_id,auth_user_id,full_name) values($1,$2,$2,'Synthetic ambiguous')", [card, athlete])
      await upgrade.query("insert into public.client_trainers(client_id,trainer_id,note) values($1,$2,'first private note'),($1,$3,'second private note')", [card, first, second])
      const legacyAthlete = randomUUID(), legacyCard = randomUUID()
      await upgrade.query("insert into public.profiles(id,account_role) values($1,'client')", [legacyAthlete])
      await upgrade.query("insert into public.clients(id,trainer_id,auth_user_id,full_name) values($1,$2,$2,'Synthetic unambiguous')", [legacyCard, legacyAthlete])
      await upgrade.query("insert into public.client_trainers(client_id,trainer_id,joined_at,note) values($1,$2,'2026-08-01T12:00:00Z','preserved legacy note')", [legacyCard, first])
      const before = (await upgrade.query("select pg_get_functiondef('public.can_access_client(uuid)'::regprocedure) body")).rows
      await expect(runner(settings)).rejects.toThrow('single_trainer_ambiguous_legacy_data')
      expect((await upgrade.query("select pg_get_functiondef('public.can_access_client(uuid)'::regprocedure) body")).rows).toEqual(before)
      expect((await upgrade.query("select count(*)::int count from app_private.fit_migrations where name like '000149%' or name like '000150%'")).rows).toEqual([{ count: 0 }])
      // Exact choice is part of this synthetic fixture, never a heuristic repair.
      await upgrade.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)', [card, first, athlete])
      await runner(settings)
      expect((await upgrade.query('select trainer_id,auth_user_id from public.clients where id=$1', [card])).rows).toEqual([{ trainer_id: athlete, auth_user_id: athlete }])
      expect((await upgrade.query('select note from public.client_trainers where client_id=$1 order by note', [card])).rows).toEqual([{ note: 'first private note' }, { note: 'second private note' }])
      expect((await upgrade.query('select trainer_id,status,connected_at from public.client_trainer_relationships where client_id=$1', [legacyCard])).rows)
        .toEqual([{ trainer_id: first, status: 'active', connected_at: new Date('2026-08-01T12:00:00Z') }])
      expect((await upgrade.query('select note from public.client_trainers where client_id=$1', [legacyCard])).rows).toEqual([{ note: 'preserved legacy note' }])
    } finally { await upgrade.end() }
  })
})
