import { createHash, randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { runner } from 'node-pg-migrate'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { runPreparedNewCardImport, type JournalReceipt } from '../../../../scripts/cloudru-journal-import.mjs'
import { readSavePlannedWorkoutRequest } from '../planned-workout-request.js'
import { saveCompletedWorkout } from '../workout-commands.js'
import { createClientCard } from '../domain-commands.js'

const source = process.env.TEST_DATABASE_URL
const database = `fit_private_journal_${process.pid}`
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

// Actual commands/RLS, transaction rollback and packet replay are distinct from
// the existing ordinary single-workout lifecycle coverage. No real journal/IDs.
describe.skipIf(source === undefined)('one private journal into a new card', { concurrent: false }, () => {
  let admin: Pool
  let pool: Pool
  const connections: PoolClient[] = []
  let imported: Awaited<ReturnType<typeof prepareFixture>> | undefined
  let appended: Awaited<ReturnType<typeof appendFixture>> | undefined
  let created = false
  beforeAll(async () => {
    const url = new URL(source ?? '')
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/fit_actor_test') {
      throw new Error('local_fit_actor_test_database_required')
    }
    admin = new Pool({ connectionString: url.href, max: 1 })
    await admin.query(`do $$ begin
      perform pg_advisory_xact_lock(193635, 1);
      if not exists (select 1 from pg_roles where rolname='fit_api') then create role fit_api login; end if;
    end $$;`)
    // Exercise the production-compatible C locale: lower() can leave Cyrillic
    // unchanged, so JavaScript must not pre-fold only the supplied name.
    await admin.query(`create database ${database} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`)
    created = true
    url.pathname = `/${database}`
    await runner({ databaseUrl: url.href, dir: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
      direction: 'up', migrationsTable: 'fit_migrations', migrationsSchema: 'app_private',
      createMigrationsSchema: true, verbose: false, log: () => {} })
    pool = new Pool({ connectionString: url.href, max: 8 })
  })
  afterAll(async () => {
    for (const connection of connections) connection.release(true)
    if (pool) await pool.end()
    if (created) await admin.query(`drop database ${database}`)
    if (admin) await admin.end()
  })
  afterEach(() => {
    for (let i = connections.length - 1; i >= 0; i--) {
      const connection = connections[i]!
      if (connection !== imported?.owner && connection !== imported?.runtime && connection !== appended?.owner && connection !== appended?.runtime) {
        connection.release(true)
        connections.splice(i, 1)
      }
    }
  })

  async function prepareFixture(linked = true, foreignPartition = false) {
    const owner = await pool.connect()
    connections.push(owner)
    const runtime = await pool.connect()
    connections.push(runtime)
    // Fixture connections never cross scenario boundaries after a timed-out test.
    // SET ROLE is test setup only; production connects as fit_api directly.
    await runtime.query('set role fit_api')
    const coach = randomUUID(), other = randomUUID()
    await owner.query("insert into public.profiles(id,account_role) values($1,'trainer'),($2,'trainer')", [coach, other])
    await owner.query('insert into public.trainers(profile_id) values($1),($2)', [coach, other])
    const loginHash = hash(`synthetic-journal-login-${coach}`)
    await owner.query('insert into app_private.fit_lime_pilot_allowlist(login_sha256,profile_id,enabled) values($1,$2,true)', [loginHash, coach])
    const existing = randomUUID(), oldWorkout = randomUUID()
    const partition = foreignPartition ? other : coach
    await owner.query("insert into public.clients(id,trainer_id,full_name) values($1,$2,'Unrelated synthetic card')", [existing, partition])
    await owner.query("insert into public.workouts(id,trainer_id,created_by,client_id,workout_date,status,completed_at,notes) values($1,$2,$2,$3,'2020-01-01','done',now(),'Keep existing')", [oldWorkout, partition, existing])
    const before = (await owner.query('select to_jsonb(w) value from public.workouts w where id=$1', [oldWorkout])).rows
    const workouts = Array.from({ length: 137 }, (_, index) => ({
      sourceOrdinal: index + 1, clientId: existing, requestId: randomUUID(),
      workoutDate: new Date(Date.UTC(2025, 7, 17 + (index === 121 ? 120 : index))).toISOString().slice(0, 10),
      startTime: null, endTime: null, actualDurationSec: null, trainingFormat: 'with_trainer',
      notes: `Synthetic source ${index}`, ...(index === 136 ? { title: 'Synthetic empty session' } : {}),
      exercises: Array.from({ length: index === 136 ? 0 : index < 97 ? 5 : 4 }, (_, position) => ({
        position, source: 'system', ref: `snapshot:journal:${randomUUID()}`, customExerciseId: null,
        name: `Synthetic movement ${index} ${position}`, muscleGroup: 'other', inputKind: index === 0 && position === 0 ? 'duration' : 'strength',
        blockId: randomUUID(), blockType: 'single', blockPreset: 'set', blockRounds: 1,
        restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0, trainerComment: null,
        sets: index < 60 && position === 0 ? Array.from({ length: 4 }, (_, set) => ({
          position: set, weightKg: index % 2 ? 7.5 : null, reps: index === 0 ? null : 12, durationMin: null,
          durationSec: index === 0 ? 300 : null, distanceKm: null, rpe: null,
          metricSources: { duration: index === 0 ? 'entered' : 'unknown', distance: 'unknown', rpe: 'unknown' },
        })) : [],
      })),
    }))
    expect(workouts.reduce((n, w) => n + w.exercises.length, 0)).toBe(641)
    const packet = (name: string, freshRequests = false) => {
      const value = { schemaVersion: 1, batchId: 'synthetic-journal', clientName: name,
        workouts: freshRequests ? workouts.map(w => ({ ...w, requestId: randomUUID() })) : workouts }
      const raw = JSON.stringify(value), encoded = gzipSync(raw).toString('base64')
      const split = Math.min(47000, Math.ceil(encoded.length / 2))
      return { parts: [encoded.slice(0, split), encoded.slice(split)], approvedSha256: hash(raw),
        target: { trainerLoginSha256: loginHash, trainerEmailSha256: hash(`synthetic-journal-email-${coach}`), clientNameSha256: hash(name.toLowerCase()) } }
    }
    const receipts: { state: string; receipt: JournalReceipt }[] = []
    const options = { mode: 'inspect' as const, owner, runtime, legacyId: coach, ...packet('Synthetic import'),
      readRequest: readSavePlannedWorkoutRequest, saveCompleted: saveCompletedWorkout, createCard: createClientCard,
      persistReceipt: (state: string, receipt: JournalReceipt) => { receipts.push({ state, receipt }); return Promise.resolve() } }
    if (linked) await owner.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id,identity_origin) values('yandex',$1,$2,'native')", [hash(`synthetic-journal-subject-${coach}`), coach])
    return { owner, runtime, coach, other, existing, oldWorkout, before, packet, receipts, options, workouts }
  }

  it('refuses unlinked or conflicting identities and inspects without writing a card', async () => {
    const { owner, coach, other, options } = await prepareFixture(false)
    await expect(runPreparedNewCardImport(options)).rejects.toThrow('current_trainer_identity_required')
    await owner.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id,identity_origin) values('yandex',$1,$2,'native')", [hash(`synthetic-journal-subject-${coach}`), coach])
    await expect(runPreparedNewCardImport({ ...options, legacyId: other })).rejects.toThrow('trainer_ambiguous')
    expect(await runPreparedNewCardImport(options)).toMatchObject({ status: 'ready', readOnly: true, workouts: 137 })
    expect((await owner.query<{ n: number }>("select count(*)::int n from public.clients where trainer_id=$1 and full_name='Synthetic import'", [coach])).rows[0]?.n).toBe(0)
    await expect(runPreparedNewCardImport({ ...options, approvedSha256: '0'.repeat(64) })).rejects.toThrow('private_payload_invalid')
  })

  it('commits all snapshots and leaves unrelated history and finances unchanged', async () => {
    const fixture = await prepareFixture()
    const { owner, options, receipts, oldWorkout, before } = fixture
    const saved = await runPreparedNewCardImport({ ...options, mode: 'apply' })
    expect(saved).toMatchObject({ status: 'imported', workouts: 137, exercises: 641, sets: 240, contentVerified: true, athleteLinked: false })
    expect(receipts.map(r => r.state)).toEqual(['prepared', 'committed', 'readback'])
    expect((await owner.query('select to_jsonb(w) value from public.workouts w where id=$1', [oldWorkout])).rows).toEqual(before)
    const importedCard = receipts[0]?.receipt.clientId
    expect(importedCard).toBeTruthy()
    expect((await owner.query<{ n: number }>("select count(*)::int n from public.workouts where client_id=$1 and workout_date='2025-12-15'", [importedCard])).rows[0]?.n).toBe(2)
    for (const table of ['trainer_finance_packages', 'trainer_finance_payments', 'trainer_finance_sessions']) {
      expect((await owner.query<{ n: number }>(`select count(*)::int n from public.${table} where client_id=$1`, [importedCard])).rows[0]?.n).toBe(0)
    }
    imported = fixture
  })

  it('replays the committed batch without a second card or duplicate workouts', async () => {
    if (!imported) throw new Error('successful_import_fixture_required')
    const { owner, coach, options } = imported
    expect((await runPreparedNewCardImport({ ...options, mode: 'apply' })).status).toBe('already_imported')
    expect((await owner.query<{ n: number }>("select count(*)::int n from public.clients where trainer_id=$1 and full_name='Synthetic import'", [coach])).rows[0]?.n).toBe(1)
  })

  it('rolls back the new card and every workout after a late receipt failure', async () => {
    const { owner, coach, options, packet } = await prepareFixture()
    await expect(runPreparedNewCardImport({ ...options, mode: 'apply', ...packet('Synthetic rollback', true),
      persistReceipt: () => Promise.reject(new Error('synthetic receipt failure')) })).rejects.toThrow('failed_rolled_back')
    expect((await owner.query<{ n: number }>("select count(*)::int n from public.clients where trainer_id=$1 and full_name='Synthetic rollback'", [coach])).rows[0]?.n).toBe(0)
  })

  it('refuses to overwrite facts edited after the import', async () => {
    if (!imported) throw new Error('successful_import_fixture_required')
    const { owner, options, receipts } = imported
    const first = receipts[0]?.receipt.created[1]?.workoutId
    await owner.query("update public.workout_sets s set fact_weight_kg=99 from public.workout_exercises e where e.id=s.workout_exercise_id and e.workout_id=$1", [first])
    await expect(runPreparedNewCardImport({ ...options, mode: 'apply' })).rejects.toThrow('content_readback_failed')
    expect((await owner.query<{ n: number }>('select count(*)::int n from public.workout_sets s join public.workout_exercises e on e.id=s.workout_exercise_id where e.workout_id=$1 and s.fact_weight_kg=99', [first])).rows[0]?.n).toBe(4)
  })

  for (const count of [85, 72]) it(`imports the reviewed ${count}-session packet with its name kept off GitHub configuration`, async () => {
    if (!imported) throw new Error('successful_import_fixture_required')
    const { owner, options, receipts, workouts: seed, coach } = imported
    const total = count === 85 ? 401 : 413
    const from = count === 85 ? '2025-06-08' : '2026-01-05'
    const name = `Synthetic additional ${count}`
    const workouts = Array.from({ length: count }, (_, index) => ({
      ...seed[0]!, sourceOrdinal: index + 1, requestId: randomUUID(),
      workoutDate: new Date(Date.parse(from + 'T00:00:00Z') + index * 86400000).toISOString().slice(0, 10),
      notes: `Historical context, no invented sets ${index}`,
      exercises: Array.from({ length: count === 85 ? index < 65 ? 5 : index === 84 ? 0 : 4 : index < 53 ? 6 : 5 }, (_, position) => ({
        ...seed[0]!.exercises[0]!, position, ref: `snapshot:journal:${randomUUID()}`,
        blockId: randomUUID(), name: `Historical literal ${index}/${position}`, sets: [],
      })),
    }))
    const encode = (value: unknown) => {
      const raw = JSON.stringify(value), encoded = gzipSync(raw).toString('base64'), middle = Math.ceil(encoded.length / 2)
      return { parts: [encoded.slice(0, middle), encoded.slice(middle)], approvedSha256: hash(raw) }
    }
    const payload = { schemaVersion: 2, batchId: `synthetic-additional-${count}`, clientName: name, workouts }
    const packet = encode(payload)
    // The existing actor/legacy name hash remains unchanged. The newly approved
    // name is authenticated by the complete packet digest, only on Cloud.ru.
    expect(await runPreparedNewCardImport({ ...options, ...packet })).toMatchObject({ status: 'ready', workouts: count, exercises: total, sets: 0 })
    const changedName = encode({ ...payload, clientName: 'Redirected' })
    await expect(runPreparedNewCardImport({ ...options, parts: changedName.parts, approvedSha256: packet.approvedSha256 })).rejects.toThrow('private_payload_invalid')
    const outOfRange = encode({ ...payload, workouts: workouts.map((w, i) => i ? w : { ...w, workoutDate: '2024-01-01' }) })
    await expect(runPreparedNewCardImport({ ...options, ...outOfRange })).rejects.toThrow('dates_invalid')
    expect(await runPreparedNewCardImport({ ...options, ...packet, mode: 'apply' })).toMatchObject({ status: 'imported', workouts: count, exercises: total, sets: 0, contentVerified: true })
    const card = receipts.at(-1)?.receipt.clientId
    expect((await owner.query<{ n: number }>('select count(*)::int n from public.workouts where client_id=$1', [card])).rows[0]?.n).toBe(count)
    for (const table of ['trainer_finance_packages', 'trainer_finance_payments', 'trainer_finance_sessions']) {
      expect((await owner.query<{ n: number }>(`select count(*)::int n from public.${table} where client_id=$1`, [card])).rows[0]?.n).toBe(0)
    }
    expect((await owner.query<{ n: number }>("select count(*)::int n from public.workouts w join public.clients c on c.id=w.client_id where c.trainer_id=$1 and c.full_name='Synthetic import'", [coach])).rows[0]?.n).toBe(137)
    const first = receipts[0]?.receipt.created[1]?.workoutId
    expect((await owner.query<{ n: number }>('select count(*)::int n from public.workout_sets s join public.workout_exercises e on e.id=s.workout_exercise_id where e.workout_id=$1 and s.fact_weight_kg=99', [first])).rows[0]?.n).toBe(4)
  })

  async function appendFixture(linked = false, foreignPartition = false, name = 'Synthetic existing') {
    const f = await prepareFixture(true, foreignPartition)
    await f.owner.query('update public.clients set full_name=$2,goal=$3 where id=$1', [f.existing, name, 'Keep goal'])
    await f.owner.query('insert into public.client_trainers(client_id,trainer_id,note) values($1,$2,$3)',
      [f.existing, f.coach, 'Keep private note'])
    const athlete = linked ? randomUUID() : null
    if (athlete) {
      await f.owner.query("insert into public.profiles(id,account_role) values($1,'client')", [athlete])
      await f.owner.query('update public.clients set auth_user_id=$2 where id=$1', [f.existing, athlete])
      await f.owner.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)',
        [f.existing, f.coach, athlete])
    }
    await f.owner.query("update public.workouts set workout_date='2025-06-08' where id=$1", [f.oldWorkout])
    const packetWorkouts = Array.from({ length: 85 }, (_, i) => ({ ...f.workouts[0]!,
      requestId: randomUUID(), sourceOrdinal: i + 1,
      workoutDate: new Date(Date.UTC(2025, 5, 8 + i)).toISOString().slice(0, 10),
      exercises: Array.from({ length: i < 65 ? 5 : i === 84 ? 0 : 4 }, (_, position) => ({
        ...f.workouts[0]!.exercises[0]!, position, name: `Synthetic literal ${i}/${position}`,
        inputKind: 'strength', blockId: randomUUID(), ref: `snapshot:journal:${randomUUID()}`, sets: [],
      })),
    }))
    const encode = (schemaVersion: number) => {
      const raw = JSON.stringify({ schemaVersion, batchId: 'synthetic-append', clientName: name, workouts: packetWorkouts })
      const data = gzipSync(raw).toString('base64'), middle = Math.ceil(data.length / 2)
      return { parts: [data.slice(0, middle), data.slice(middle)], approvedSha256: hash(raw) }
    }
    await f.runtime.query('begin')
    await f.runtime.query("select set_config('request.jwt.claim.sub',$1,true)", [f.coach])
    const request = readSavePlannedWorkoutRequest({ ...f.workouts[1]!, requestId: randomUUID(), workoutDate: '2026-10-30' }, null)
    if (!request) throw new Error('fixture_request_required')
    const old = await saveCompletedWorkout({ query: async <Row extends QueryResultRow>(sql: string, args?: readonly unknown[]) =>
      (await f.runtime.query<Row>(sql, args ? [...args] : undefined)).rows }, request.draft, null)
    await f.runtime.query('commit')
    await f.owner.query('update public.workout_sets s set fact_weight_kg=99 from public.workout_exercises e where e.id=s.workout_exercise_id and e.workout_id=$1', [old.id])
    const packageId = randomUUID()
    if (!foreignPartition) {
    await f.owner.query(`insert into public.trainer_finance_packages(id,trainer_id,client_id,title,sessions_total,price_cents,starts_on)
      values($1,$2,$3,'Keep finance',10,50000,'2025-01-01')`, [packageId, f.coach, f.existing])
    await f.owner.query(`insert into public.trainer_finance_payments(package_id,trainer_id,client_id,amount_cents,received_on)
      values($1,$2,$3,50000,'2025-01-01')`, [packageId, f.coach, f.existing])
    await f.owner.query(`insert into public.trainer_finance_sessions(package_id,trainer_id,client_id,workout_id,disposition,source)
      values($1,$2,$3,$4,'charged','manual')`, [packageId, f.coach, f.existing, f.oldWorkout])
    }
    const oldIds = [f.oldWorkout, old.id]
    const oldState = async () => {
      const state: unknown[] = []
      state.push((await f.owner.query('select to_jsonb(c) value from public.clients c where id=$1', [f.existing])).rows)
      state.push((await f.owner.query('select to_jsonb(c) value from public.client_trainers c where client_id=$1 order by trainer_id', [f.existing])).rows)
      state.push((await f.owner.query('select to_jsonb(c) value from public.client_trainer_relationships c where client_id=$1 order by id', [f.existing])).rows)
      state.push((await f.owner.query('select to_jsonb(w) value from public.workouts w where id=any($1::uuid[]) order by id', [oldIds])).rows)
      state.push((await f.owner.query('select to_jsonb(e) value from public.workout_exercises e where workout_id=any($1::uuid[]) order by id', [oldIds])).rows)
      state.push((await f.owner.query('select to_jsonb(s) value from public.workout_sets s join public.workout_exercises e on e.id=s.workout_exercise_id where e.workout_id=any($1::uuid[]) order by s.id', [oldIds])).rows)
      for (const table of ['trainer_finance_packages', 'trainer_finance_payments', 'trainer_finance_sessions']) {
        const where = table === 'trainer_finance_sessions' ? 'and workout_id=any($2::uuid[])' : ''
        state.push((await f.owner.query(`select to_jsonb(x) value from public.${table} x where client_id=$1 ${where} order by id`,
          table === 'trainer_finance_sessions' ? [f.existing, oldIds] : [f.existing])).rows)
      }
      return state
    }
    const before = await oldState()
    let selected: string | undefined
    const selectionBinding = (mode: 'inspect' | 'apply', fingerprint: string) => {
      if ((selected !== undefined && selected !== fingerprint) || (mode === 'apply' && selected === undefined)) throw new Error('journal_import_selection_changed')
      selected = fingerprint
      return Promise.resolve()
    }
    return { ...f, athlete, oldIds, oldState, before, encode, packageId, oldVersion: old.version,
      oldDraft: { ...request.draft, id: old.id, notes: 'Changed by faulty writer' },
      options: { ...f.options, ...encode(3), selectionBinding } }
  }

  it('appends into the unique confirmed linked card and preserves full old graphs and finances, including overlapping dates', async () => {
    const f = await appendFixture(true)
    expect(await runPreparedNewCardImport(f.options)).toMatchObject({ status: 'ready', readOnly: true, appendOnly: true,
      willCreateCard: false, existingWorkouts: 2, athleteLinked: true })
    expect(await runPreparedNewCardImport({ ...f.options, mode: 'apply' })).toMatchObject({ status: 'imported',
      workouts: 85, contentVerified: true, appendOnly: true, previousStateVerified: true, preservedWorkouts: 2, athleteLinked: true })
    expect(await f.oldState()).toEqual(f.before)
    expect(f.receipts.at(-1)?.receipt).toMatchObject({ createdCard: false, athleteId: f.athlete, appendOnly: true })
    expect(f.receipts.at(-1)?.receipt.clientId).toBe(f.existing)
    appended = f
  })

  it('replays the appended batch without duplicate workouts or package deductions', async () => {
    if (!appended) throw new Error('successful_append_fixture_required')
    const f = appended
    expect(await runPreparedNewCardImport({ ...f.options, mode: 'apply' })).toMatchObject({ status: 'already_imported', preservedWorkouts: 2 })
    expect(await f.oldState()).toEqual(f.before)
    expect((await f.owner.query<{ n: number }>('select count(*)::int n from public.workouts where client_id=$1', [f.existing])).rows[0]?.n).toBe(87)
    expect((await f.owner.query<{ n: number }>("select count(*)::int n from public.trainer_finance_sessions where client_id=$1 and disposition='charged' and voided_at is null", [f.existing])).rows[0]?.n).toBe(1)
    expect((await f.owner.query<{ n: number }>("select count(*)::int n from public.trainer_finance_sessions where client_id=$1 and disposition='unassigned' and package_id is null and voided_at is null", [f.existing])).rows[0]?.n).toBe(85)
  })

  it('does not undo a later manual billing decision on an imported workout', async () => {
    if (!appended) throw new Error('successful_append_fixture_required')
    const f = appended
    const edited = f.receipts.at(-1)?.receipt.created[0]?.workoutId
    await f.owner.query("update public.trainer_finance_sessions set disposition='charged',package_id=$2 where workout_id=$1", [edited, f.packageId])
    await expect(runPreparedNewCardImport({ ...f.options, mode: 'apply' })).rejects.toThrow('unexpected_finance_change')
    expect((await f.owner.query<{ disposition: string }>('select disposition from public.trainer_finance_sessions where workout_id=$1', [edited])).rows[0]?.disposition).toBe('charged')
  })

  it('does not overwrite a later edit to the appended workout', async () => {
    if (!appended) throw new Error('successful_append_fixture_required')
    const f = appended
    const edited = f.receipts.at(-1)?.receipt.created[0]?.workoutId
    await f.owner.query("update public.workouts set notes='Keep later human edit' where id=$1", [edited])
    await expect(runPreparedNewCardImport({ ...f.options, mode: 'apply' })).rejects.toThrow('content_readback_failed')
    expect((await f.owner.query<{ notes: string }>('select notes from public.workouts where id=$1', [edited])).rows[0]?.notes).toBe('Keep later human edit')
  })

  it('finds a Cyrillic name and alias under the C locale without changing card identity', async () => {
    const name = 'Синтетическая'
    const f = await appendFixture(false, false, name)
    expect((await f.owner.query<{ matches: boolean }>('select lower($1) = lower($2) matches', [name, name.toLowerCase()])).rows[0]?.matches).toBe(false)
    expect(await runPreparedNewCardImport(f.options)).toMatchObject({ status: 'ready', willCreateCard: false, existingWorkouts: 2 })
    await f.owner.query("update public.clients set full_name='Different card name' where id=$1", [f.existing])
    await f.owner.query('update public.client_trainers set alias=$2 where client_id=$1 and trainer_id=$3', [f.existing, `${name} Alias`, f.coach])
    expect(await runPreparedNewCardImport(f.options)).toMatchObject({ status: 'ready', willCreateCard: false, existingWorkouts: 2 })
    expect((await f.owner.query<{ n: number }>('select count(*)::int n from public.workouts where client_id=$1', [f.existing])).rows[0]?.n).toBe(2)
  })

  it('keeps schema2 collision protection and refuses ambiguous or missing append targets', async () => {
    const f = await appendFixture()
    await expect(runPreparedNewCardImport({ ...f.options, ...f.encode(2) })).rejects.toThrow('existing_name_requires_review')
    const extra = randomUUID()
    await f.owner.query("insert into public.clients(id,trainer_id,full_name) values($1,$2,'Synthetic existing')", [extra, f.coach])
    await expect(runPreparedNewCardImport(f.options)).rejects.toThrow('existing_card_ambiguous')
    await f.owner.query('update public.clients set archived_at=now() where trainer_id=$1', [f.coach])
    await expect(runPreparedNewCardImport(f.options)).rejects.toThrow('existing_card_missing')
    expect((await f.owner.query<{ n: number }>('select count(*)::int n from public.workouts where client_id=$1', [f.existing])).rows[0]?.n).toBe(2)
  })

  it('rolls back the complete append if an existing fact is changed by the writer', async () => {
    const f = await appendFixture()
    await runPreparedNewCardImport(f.options)
    let first = true
    await expect(runPreparedNewCardImport({ ...f.options, mode: 'apply', saveCompleted: async (...args: Parameters<typeof saveCompletedWorkout>) => {
      if (first) {
        first = false
        await saveCompletedWorkout(args[0], f.oldDraft, f.oldVersion)
      }
      return saveCompletedWorkout(...args)
    } })).rejects.toThrow('previous_state_changed')
    expect(await f.oldState()).toEqual(f.before)
    expect((await f.owner.query<{ n: number }>('select count(*)::int n from public.workouts where client_id=$1', [f.existing])).rows[0]?.n).toBe(2)
  })

  it('uses the active coaching relationship without reassigning a historical partition', async () => {
    const f = await appendFixture(true, true)
    await expect(runPreparedNewCardImport({ ...f.options, mode: 'apply' })).rejects.toThrow('selection_changed')
    await runPreparedNewCardImport(f.options)
    expect(await runPreparedNewCardImport({ ...f.options, mode: 'apply' })).toMatchObject({
      status: 'imported', athleteLinked: true, previousStateVerified: true, preservedWorkouts: 2 })
    expect(await f.oldState()).toEqual(f.before)
    expect((await f.owner.query<{ trainer_id: string }>('select trainer_id from public.clients where id=$1', [f.existing])).rows[0]?.trainer_id).toBe(f.other)
  })

  it('does not treat a private note membership as active coaching after disconnection', async () => {
    const f = await appendFixture(true)
    await f.owner.query("update public.client_trainer_relationships set status='disconnected',disconnected_at=now(),disconnected_by=$2 where client_id=$1", [f.existing, f.coach])
    await expect(runPreparedNewCardImport({ ...f.options, mode: 'apply' })).rejects.toThrow('selection_changed')
    expect((await f.owner.query<{ n: number }>('select count(*)::int n from public.workouts where client_id=$1', [f.existing])).rows[0]?.n).toBe(2)
  })

  it('binds apply to the card verified by inspect instead of a later name match', async () => {
    const f = await appendFixture()
    await runPreparedNewCardImport(f.options)
    await f.owner.query("update public.clients set full_name='Renamed after inspect' where id=$1", [f.existing])
    const replacement = randomUUID()
    await f.owner.query("insert into public.clients(id,trainer_id,full_name) values($1,$2,'Synthetic existing')", [replacement, f.coach])
    await expect(runPreparedNewCardImport({ ...f.options, mode: 'apply' })).rejects.toThrow('selection_changed')
    expect((await f.owner.query<{ n: number }>('select count(*)::int n from public.workouts where client_id=$1', [replacement])).rows[0]?.n).toBe(0)
    expect((await f.owner.query<{ n: number }>('select count(*)::int n from public.workouts where client_id=$1', [f.existing])).rows[0]?.n).toBe(2)
  })
})
