import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool, type QueryResultRow } from 'pg'
import { runner } from 'node-pg-migrate'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const source = process.env.TEST_DATABASE_URL
const database = `fit_live_history_${process.pid}`
const directory = fileURLToPath(new URL('../../db/migrations', import.meta.url))
interface PrefilledSetRow extends QueryResultRow {
  position: number
  plan_weight_kg: string | null
  plan_reps: number | null
  plan_duration_sec: number | null
  plan_distance_km: string | null
  fact_weight_kg: string | null
  confirmed_at: Date | null
}

describe.skipIf(!source)('atomic Live history prefill with real ownership', () => {
  let owner: Pool, pool: Pool
  let created = false
  const coach = randomUUID(), athlete = randomUUID(), outsider = randomUUID(), card = randomUUID(), otherCard = randomUUID()
  beforeAll(async () => {
    const url = new URL(source ?? '')
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/fit_actor_test') throw new Error('local_fit_actor_test_database_required')
    owner = new Pool({ connectionString: url.href })
    await owner.query(`do $$ begin perform pg_advisory_xact_lock(193635,1);
      if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api login; end if; end $$`)
    await owner.query(`create database ${database}`); created = true
    url.pathname = `/${database}`
    await runner({ databaseUrl: url.href, dir: directory, direction: 'up', migrationsTable: 'fit_migrations', migrationsSchema: 'app_private', createMigrationsSchema: true, verbose: false, log: () => {} })
    pool = new Pool({ connectionString: url.href })
    await pool.query(`insert into public.profiles(id,first_name,account_role) values($1,'Synthetic coach','trainer'),($2,'Synthetic athlete','client'),($3,'Synthetic outsider','trainer')`, [coach, athlete, outsider])
    await pool.query('insert into public.trainers(profile_id) values($1),($2)', [coach, outsider])
    await pool.query(`insert into public.clients(id,trainer_id,auth_user_id,full_name) values($1,$2,$3,'Synthetic client'),($4,$5,null,'Other client')`, [card, coach, athlete, otherCard, outsider])
    await pool.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)', [card, coach, athlete])
  }, 90_000)
  beforeEach(async () => { await pool.query('delete from public.workouts') })
  afterAll(async () => { if (pool) await pool.end(); if (created) await owner.query(`drop database ${database}`); if (owner) await owner.end() })

  async function target(clientId = card, trainerId = coach) {
    const id = randomUUID()
    await pool.query(`insert into public.workouts(id,client_id,trainer_id,created_by,workout_date,status,started_at)
      values($1,$2,$3,$3,'2026-10-29','in_progress',now())`, [id, clientId, trainerId])
    return id
  }
  async function history(kind = 'strength', date = '2026-10-27', clientId = card, trainerId = coach, author = coach, confirmed = true) {
    const workoutId = randomUUID(), exerciseId = randomUUID()
    await pool.query(`insert into public.workouts(id,client_id,trainer_id,created_by,workout_date,status,completed_at)
      values($1,$2,$3,$4,$5,'done',now())`, [workoutId, clientId, trainerId, author, date])
    await pool.query(`insert into public.workout_exercises(id,workout_id,trainer_id,client_id,position,exercise_source,exercise_ref,exercise_name,muscle_group,input_kind)
      values($1,$2,$3,$4,0,'system','history-test','Synthetic exercise','legs',$5)`, [exerciseId, workoutId, trainerId, clientId, kind])
    for (const position of [0, 1]) await pool.query(`insert into public.workout_sets(workout_exercise_id,trainer_id,client_id,position,
      fact_weight_kg,fact_reps,fact_duration_sec,fact_distance_km,confirmed_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,case when $9 then now() else null end)`,
    [exerciseId, trainerId, clientId, position, kind === 'strength' ? 30 + position : null,
      kind === 'strength' || kind === 'reps' ? 10 + position : null,
      kind !== 'strength' ? 60 + position : null, kind === 'distance' ? 1.2 + position : null, confirmed])
    return { workoutId, exerciseId }
  }
  async function append(actorId: string, workoutId: string, kind = 'strength', prefill?: boolean, operationId = randomUUID(), version = 1) {
    const c = await pool.connect()
    try {
      await c.query('begin'); await c.query("select set_config('request.jwt.claim.sub',$1,true)", [actorId]); await c.query('set local role fit_api')
      const exercise = { source: 'system', ref: 'history-test', customExerciseId: null, name: 'Synthetic exercise', muscleGroup: 'legs', inputKind: kind, ...(prefill === undefined ? {} : { prefillFromHistory: prefill }) }
      const result = await c.query('select * from public.append_live_exercise($1,$2::jsonb,$3,$4)', [workoutId, JSON.stringify(exercise), version, operationId])
      await c.query('commit'); return result.rows[0] as { resource_id: string; version: string; replayed: boolean }
    } catch (error) { await c.query('rollback'); throw error } finally { c.release() }
  }
  const sets = async (id: string) => (await pool.query<PrefilledSetRow>(`select position,plan_weight_kg,plan_reps,plan_duration_sec,plan_distance_km,fact_weight_kg,confirmed_at
    from public.workout_sets where workout_exercise_id=$1 order by position`, [id])).rows

  it.each(['strength', 'reps', 'duration', 'distance'])('seeds confirmed %s values as an unconfirmed plan for either actor role', async kind => {
    const before = await history(kind)
    await history(kind, '2026-10-28', card, coach, coach, false)
    const result = await append(kind === 'strength' ? coach : athlete, await target(), kind, true)
    const rows = await sets(result.resource_id)
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.position)).toEqual([0, 1])
    expect(rows.every(row => row.confirmed_at === null && row.fact_weight_kg === null)).toBe(true)
    if (kind === 'strength') expect(rows.map(row => Number(row.plan_weight_kg))).toEqual([30, 31])
    if (kind === 'reps') expect(rows.map(row => row.plan_reps)).toEqual([10, 11])
    if (kind !== 'strength') expect(rows.map(row => row.plan_duration_sec)).toEqual([60, 61])
    if (kind === 'distance') expect(rows.map(row => Number(row.plan_distance_km))).toEqual([1.2, 2.2])
    expect((await pool.query('select count(*)::int n from public.workout_sets where workout_exercise_id=$1 and confirmed_at is not null', [before.exerciseId])).rows).toEqual([{ n: 2 }])
  })
  it('preserves the old empty set outside opt-in and skips missing, foreign, unreadable or incompatible history', async () => {
    await history('strength', '2026-10-28', otherCard, outsider, outsider)
    await history('strength', '2026-10-28', card, coach, outsider)
    await history('duration')
    const id = await target()
    const result = await append(coach, id, 'strength', true)
    expect(await sets(result.resource_id)).toMatchObject([{ plan_weight_kg: null, plan_reps: null, confirmed_at: null }])
    await history()
    const legacy = await append(coach, id, 'strength', undefined, randomUUID(), 2)
    expect(await sets(legacy.resource_id)).toMatchObject([{ plan_weight_kg: null }])
    await expect(append(outsider, id, 'strength', true, randomUUID(), 3)).rejects.toMatchObject({ code: 'PT403' })
  })
  it('replays without duplicate sets or overwriting later edits, and preserves version conflicts', async () => {
    await history()
    const id = await target(), operation = randomUUID()
    const first = await append(coach, id, 'strength', true, operation)
    await pool.query('update public.workout_sets set plan_weight_kg=99 where workout_exercise_id=$1 and position=0', [first.resource_id])
    expect(await append(coach, id, 'strength', true, operation)).toEqual({ ...first, replayed: true })
    expect((await sets(first.resource_id)).map(row => Number(row.plan_weight_kg))).toEqual([99, 31])
    await expect(append(coach, id, 'strength', true)).rejects.toMatchObject({ code: 'PT409' })
  })
})
