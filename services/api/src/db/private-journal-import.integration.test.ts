import { createHash, randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient } from 'pg'
import { runner } from 'node-pg-migrate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
    await admin.query(`create database ${database}`)
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

  async function prepareFixture(linked = true) {
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
    await owner.query("insert into public.clients(id,trainer_id,full_name) values($1,$2,'Unrelated synthetic card')", [existing, coach])
    await owner.query("insert into public.workouts(id,trainer_id,created_by,client_id,workout_date,status,completed_at,notes) values($1,$2,$2,$3,'2020-01-01','done',now(),'Keep existing')", [oldWorkout, coach, existing])
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
    return { owner, runtime, coach, other, oldWorkout, before, packet, receipts, options }
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
})
