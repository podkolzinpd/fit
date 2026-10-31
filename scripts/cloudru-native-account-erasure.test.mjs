import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { approvedErasureScope, runNativeErasure } from './cloudru-native-account-erasure.mjs'

const hash = text => createHash('sha256').update(text).digest('hex')
const source = process.env.TEST_DATABASE_URL
const { Client } = createRequire(new URL('../services/api/package.json', import.meta.url))('pg')
const { runner } = createRequire(new URL('../services/api/package.json', import.meta.url))('node-pg-migrate')
let admin, db, created = false, createdOwner = false
const database = `fit_native_erasure_${process.pid}`
before(async () => {
  if (!source) return
  const url = new URL(source)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/fit_actor_test') throw Error('local_fixture_database_required')
  admin = new Client({ connectionString: url.href }); await admin.connect()
  await admin.query('begin')
  await admin.query('select pg_advisory_xact_lock(193635, 1)')
  if (!(await admin.query("select 1 from pg_roles where rolname='fit_api'")).rowCount) await admin.query('create role fit_api')
  if (!(await admin.query("select 1 from pg_roles where rolname='fit_owner'")).rowCount) {
    await admin.query('create role fit_owner'); createdOwner = true
  }
  await admin.query('commit')
  await admin.query(`create database ${database} owner fit_owner`)
  created = true
  url.pathname = `/${database}`
  db = new Client({ connectionString: url.href }); await db.connect(); await db.query('set role fit_owner')
  await runner({ dbClient: db, dir: fileURLToPath(new URL('../services/api/db/migrations', import.meta.url)),
    direction: 'up', migrationsTable: 'fit_migrations', migrationsSchema: 'app_private',
    createMigrationsSchema: true, verbose: false, log: () => {} })
})
after(async () => {
  if (db) await db.end()
  if (created) await admin.query(`drop database ${database}`)
  if (createdOwner) await admin.query('drop role fit_owner')
  if (admin) await admin.end()
})

async function fixture() {
  const target = randomUUID(), coach = randomUUID(), control = randomUUID(), legacy = randomUUID()
  await db.query("insert into public.profiles(id,account_role) values($1,'client'),($2,'trainer'),($3,'client'),($4,'client')", [target, coach, control, legacy])
  await db.query('insert into public.trainers(profile_id) values($1)', [coach])
  const card = randomUUID(), otherCard = randomUUID(), oldCard = randomUUID()
  await db.query("insert into public.clients(id,trainer_id,auth_user_id,full_name) values($1,$2,$3,'Synthetic target'),($4,$2,$5,'Synthetic control'),($6,$2,$7,'Synthetic independent legacy')", [card, coach, target, otherCard, control, oldCard, legacy])
  const subject = hash(target)
  await db.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id,identity_origin) values('yandex',$1,$2,'native')", [subject, target])
  const feedback = randomUUID(), marker = 'Synthetic deletion evidence'
  await db.query("insert into public.app_feedback(id,user_id,message,account_role,display_mode,kind,screen_path,app_version,user_agent) values($1,$2,$3,'client','browser','problem','/test','test','synthetic')", [feedback, target, marker])
  const rawScope = JSON.stringify({ emailHash: hash('synthetic.invalid'), evidence: { idSha256: hash(feedback), messageSha256: hash(marker) } })
  const workout = randomUUID(), otherWorkout = randomUUID()
  await db.query("insert into public.workouts(id,trainer_id,created_by,client_id,workout_date,status,completed_at) values($1,$2,$2,$3,'2020-01-01','done',now()),($4,$2,$2,$5,'2020-01-01','done',now())", [workout, coach, card, otherWorkout, otherCard])
  const controlBefore = (await db.query('select to_jsonb(c) value from public.clients c where id=any($1::uuid[]) order by id', [[otherCard, oldCard]])).rows
  const receipts = []
  const persistReceipt = value => { receipts.push(structuredClone(value)); return Promise.resolve() }
  const options = { db, rawScope, persistReceipt }
  return { target, coach, card, otherCard, oldCard, subject, workout, otherWorkout, rawScope, receipts, options, controlBefore }
}

test('requires an exact feedback scope before any deletion', () => {
  assert.throws(() => approvedErasureScope('a'.repeat(64)), /feedback_required/)
  assert.throws(() => approvedErasureScope('{}'), /target_invalid/)
})

test('inspect is readonly; apply erases only the target and verifies recovery receipt', { skip: !source }, async () => {
  const f = await fixture()
  const exercise = randomUUID(), set = randomUUID(), conversation = randomUUID(), message = randomUUID()
  const progress = randomUUID(), metric = randomUUID(), goal = randomUUID()
  await db.query("insert into public.workout_exercises(id,workout_id,trainer_id,client_id,position,exercise_source,exercise_ref,exercise_name,muscle_group,input_kind) values($1,$2,$3,$4,0,'system','snapshot:synthetic','Synthetic movement','other','strength')", [exercise, f.workout, f.coach, f.card])
  await db.query('insert into public.workout_sets(id,workout_exercise_id,trainer_id,client_id,position,fact_reps) values($1,$2,$3,$4,0,12)', [set, exercise, f.coach, f.card])
  await db.query("insert into app_private.live_workout_operations(actor_id,operation_id,action,resource_id,request_sha256) values($1,$2,'save_set',$3,$4)", [f.coach, randomUUID(), set, hash('synthetic operation')])
  await db.query("insert into public.client_progress(id,client_id,trainer_id,created_by,recorded_on) values($1,$2,$3,$4,'2020-01-01')", [progress, f.card, f.coach, f.target])
  await db.query("insert into public.client_custom_metrics(id,client_id,trainer_id,created_by,name) values($1,$2,$3,$4,'Synthetic metric')", [metric, f.card, f.coach, f.target])
  await db.query('insert into public.client_progress_custom(client_id,trainer_id,progress_id,metric_id,value) values($1,$2,$3,$4,12)', [f.card, f.coach, progress, metric])
  await db.query("insert into public.client_goals(id,client_id,trainer_id,created_by,title) values($1,$2,$3,$4,'Synthetic goal')", [goal, f.card, f.coach, f.target])
  await db.query("insert into public.goal_stages(goal_id,client_id,trainer_id,created_by,title,starts_on,ends_on) values($1,$2,$3,$4,'Synthetic stage','2020-01-01','2020-02-01')", [goal, f.card, f.coach, f.target])
  await db.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)', [f.card, f.coach, f.target])
  await db.query('insert into public.chat_conversations(id,client_id,client_user_id,trainer_id) values($1,$2,$3,$4)', [conversation, f.card, f.target, f.coach])
  await db.query("insert into public.chat_messages(id,conversation_id,sender_id,body) values($1,$2,$3,'Synthetic text')", [message, conversation, f.target])
  await db.query("insert into app_private.yandex_app_sessions(token_sha256,profile_id,expires_at) values($1,$2,now()+interval '1 day')", [hash(randomUUID()), f.target])
  await db.query("insert into app_private.push_notifications_outbox(kind,user_id,title,body,data) values('synthetic',$1,'Test','Test',jsonb_build_object('workout_id',$2::text)),('synthetic',$1,'Keep','Keep',jsonb_build_object('workout_id',$3::text))", [f.coach, f.workout, f.otherWorkout])
  assert.equal((await runNativeErasure({ ...f.options, mode: 'inspect' })).status, 'ready')
  assert.equal(f.receipts.length, 0)
  assert.equal(Number((await db.query('select count(*) n from public.profiles where id=$1', [f.target])).rows[0].n), 1)
  assert.equal((await runNativeErasure({ ...f.options, mode: 'apply' })).accountDeleted, true)
  assert.deepEqual(f.receipts.map(r => r.phase), ['prepared', 'committed'])
  assert.equal((await runNativeErasure({ ...f.options, mode: 'verify', receipt: f.receipts[0] })).status, 'deleted_verified')
  assert.deepEqual((await db.query('select to_jsonb(c) value from public.clients c where id=any($1::uuid[]) order by id', [[f.otherCard, f.oldCard]])).rows, f.controlBefore)
  assert.equal(Number((await db.query('select count(*) n from public.workouts where id=$1', [f.otherWorkout])).rows[0].n), 1)
  for (const table of ['workout_exercises', 'workout_sets', 'client_progress', 'client_custom_metrics', 'client_progress_custom', 'client_goals', 'goal_stages']) {
    assert.equal(Number((await db.query(`select count(*) n from public.${table} where client_id=$1`, [f.card])).rows[0].n), 0)
  }
  assert.equal(Number((await db.query('select count(*) n from app_private.push_notifications_outbox where user_id=$1', [f.coach])).rows[0].n), 1)
  assert.equal(Number((await db.query('select count(*) n from app_private.live_workout_operations where resource_id=$1', [set])).rows[0].n), 0)
})

test('late failure rolls back every delete and a prepared receipt cannot falsely verify it', { skip: !source }, async () => {
  const f = await fixture()
  const failing = { query: async (sql, values) => {
    if (sql.startsWith('delete from public.profiles')) throw Error('synthetic_late_failure')
    return db.query(sql, values)
  } }
  await assert.rejects(runNativeErasure({ ...f.options, db: failing, mode: 'apply' }), /synthetic_late_failure/)
  assert.equal(Number((await db.query('select count(*) n from public.workouts where id=$1', [f.workout])).rows[0].n), 1)
  await assert.rejects(runNativeErasure({ ...f.options, mode: 'verify', receipt: f.receipts[0] }), /readback_failed/)
})

test('lost COMMIT reply is resolved by readback without a repeated deletion', { skip: !source }, async () => {
  const f = await fixture()
  const uncertain = { query: async (sql, values) => {
    const result = await db.query(sql, values)
    if (sql === 'commit') throw Error('synthetic_reply_lost')
    return result
  } }
  await assert.rejects(runNativeErasure({ ...f.options, db: uncertain, mode: 'apply' }), /outcome_unknown/)
  assert.deepEqual(f.receipts.map(r => r.phase), ['prepared'])
  assert.equal((await runNativeErasure({ ...f.options, mode: 'verify', receipt: f.receipts[0] })).accountDeleted, true)
  const mismatched = { ...f.receipts[0], scope: '0'.repeat(64) }
  await assert.rejects(runNativeErasure({ ...f.options, mode: 'verify', receipt: mismatched }), /receipt_invalid/)
})

test('wrong evidence, linked identities and runtime role cannot erase a profile', { skip: !source }, async () => {
  const f = await fixture()
  const wrong = JSON.parse(f.rawScope); wrong.evidence.messageSha256 = hash('wrong synthetic marker')
  await assert.rejects(runNativeErasure({ ...f.options, rawScope: JSON.stringify(wrong), mode: 'apply' }), /feedback_mismatch/)
  await db.query("update app_private.auth_identities set identity_origin='linked' where profile_id=$1", [f.target])
  await assert.rejects(runNativeErasure({ ...f.options, mode: 'apply' }), /native_client_required/)
  await db.query('set role fit_api')
  try { await assert.rejects(runNativeErasure({ ...f.options, mode: 'apply' }), /owner_required/) }
  finally { await db.query('reset role'); await db.query('set role fit_owner') }
  assert.equal(f.receipts.length, 0)
})

test('financial, media and shared authorship stop before writing', { skip: !source }, async () => {
  const f = await fixture()
  await db.query("insert into public.trainer_finance_packages(trainer_id,client_id,title,sessions_total,price_cents,starts_on) values($1,$2,'Synthetic package',1,100,'2020-01-01')", [f.coach, f.card])
  await assert.rejects(runNativeErasure({ ...f.options, mode: 'apply' }), /review_financial_records/)
  assert.equal(f.receipts.length, 0)
  await db.query('delete from public.trainer_finance_packages where client_id=$1', [f.card])
  await db.query('delete from public.trainer_finance_events where client_id=$1', [f.card])
  const conversation = randomUUID()
  await db.query('insert into public.chat_conversations(id,client_id,client_user_id,trainer_id) values($1,$2,$3,$4)', [conversation, f.card, f.target, f.coach])
  await db.query("insert into public.chat_messages(id,conversation_id,sender_id,image_path,image_mime_type,image_width,image_height,image_size_bytes) values($1,$2,$3,'synthetic/image.jpg','image/jpeg',1,1,1)", [randomUUID(), conversation, f.target])
  await assert.rejects(runNativeErasure({ ...f.options, mode: 'apply' }), /review_media/)
  await db.query('delete from public.chat_messages where conversation_id=$1', [conversation])
  await db.query("insert into public.client_progress(client_id,trainer_id,created_by,recorded_on) values($1,$2,$3,'2020-01-02')", [f.otherCard, f.coach, f.target])
  await assert.rejects(runNativeErasure({ ...f.options, mode: 'apply' }), /review_shared_authorship/)
  assert.equal(f.receipts.length, 0)
})
