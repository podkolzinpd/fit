import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runner } from 'node-pg-migrate'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { planClientRestore, applyClientRestore, verifyClientRestore, type RestorePlan } from '../../../../scripts/cloudru-client-restore.mjs'

const source = process.env.TEST_DATABASE_URL
const database = `fit_client_restore_${process.pid}`
describe.skipIf(source === undefined)('owner-approved canonical client restoration with real RLS', () => {
  let admin: Pool, owner: Pool, runtime: Pool
  let created = false, createdOwner = false
  beforeAll(async () => {
    const url = new URL(source ?? '')
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/fit_actor_test') throw Error('local_test_database_required')
    admin = new Pool({ connectionString: url.href, max: 1 })
    await admin.query('begin')
    await admin.query('select pg_advisory_xact_lock(193635,1)')
    if (!(await admin.query("select 1 from pg_roles where rolname='fit_api'")).rowCount) await admin.query('create role fit_api')
    if (!(await admin.query("select 1 from pg_roles where rolname='fit_owner'")).rowCount) {
      await admin.query('create role fit_owner'); createdOwner = true
    }
    await admin.query('commit')
    await admin.query(`create database ${database} owner fit_owner`); created = true
    url.pathname = `/${database}`
    // Test-only SET ROLE matches the existing operational-test bootstrap.
    // Production connects directly with its protected owner/runtime credentials.
    owner = new Pool({ connectionString: url.href, options: '-c role=fit_owner', max: 2 })
    const migrating = await owner.connect()
    try {
      await runner({ dbClient: migrating, dir: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
        direction: 'up', migrationsTable: 'fit_migrations', migrationsSchema: 'app_private',
        createMigrationsSchema: true, verbose: false, log: () => {} })
    } finally { migrating.release() }
    runtime = new Pool({ connectionString: url.href, options: '-c role=fit_api', max: 1 })
  })
  afterAll(async () => {
    if (runtime) await runtime.end()
    if (owner) await owner.end()
    if (created) await admin.query(`drop database ${database}`)
    if (createdOwner) await admin.query('drop role fit_owner')
    if (admin) await admin.end()
  })
  async function fixture() {
    const athleteId = randomUUID(), trainerId = randomUUID(), other = randomUUID(), card = randomUUID(), old = randomUUID()
    await owner.query(`insert into public.profiles(id,first_name,account_role) values
      ($1,'Synthetic athlete','client'),($2,'Synthetic trainer','trainer'),($3,'Synthetic other','trainer')`, [athleteId, trainerId, other])
    await owner.query('insert into public.trainers(profile_id) values($1),($2)', [trainerId, other])
    await owner.query(`insert into public.clients(id,trainer_id,auth_user_id,full_name) values($1,$2,$2,'Synthetic canonical')`, [card, athleteId])
    await owner.query(`insert into public.clients(id,trainer_id,full_name,merged_into_client_id,archived_at) values($1,$2,'Synthetic merged source',$3,now())`, [old, trainerId, card])
    await owner.query(`insert into public.client_trainers(client_id,trainer_id,note) values($1,$2,'Private synthetic note') on conflict do nothing`, [old, trainerId])
    await owner.query(`insert into public.client_trainer_relationships(client_id,trainer_id,status,connected_at,disconnected_at,connected_by,disconnected_by)
      values($1,$2,'disconnected',now()-interval '10 days',now()-interval '5 days',$3,$3)`, [card, trainerId, athleteId])
    const workouts = (await owner.query<{ id: string }>(`insert into public.workouts(client_id,trainer_id,created_by,workout_date,status,completed_at,notes)
      select $1,$2,$3,current_date-n,'done',now()-interval '1 day','Private synthetic result' from generate_series(1,21) n returning id`, [card, athleteId, trainerId])).rows
    const exercise = (await owner.query<{ id: string }>(`insert into public.workout_exercises(workout_id,trainer_id,client_id,position,exercise_source,exercise_ref,exercise_name,muscle_group,input_kind)
      values($1,$2,$3,0,'system','fixture:restore','Synthetic exercise','back','strength') returning id`, [workouts[0]!.id, athleteId, card])).rows[0]!
    await owner.query(`insert into public.workout_sets(workout_exercise_id,trainer_id,client_id,position,plan_weight_kg,plan_reps,fact_weight_kg,fact_reps,confirmed_at)
      values($1,$2,$3,0,10,12,12,10,now())`, [exercise.id, athleteId, card])
    return { athleteId, trainerId, other, card, old }
  }
  async function plan(f: { athleteId: string; trainerId: string }) {
    const c = await owner.connect(); try { return await planClientRestore(c, f) } finally { c.release() }
  }
  async function apply(p: RestorePlan, backupVerified = true) {
    const c = await owner.connect(); try { return await applyClientRestore(c, p, { backupVerified }) } finally { c.release() }
  }
  async function verify(p: RestorePlan) {
    const c = await runtime.connect(); try { return await verifyClientRestore(c, p) } finally { c.release() }
  }
  it('restores only the canonical connection, keeps old periods/results/notes and verifies actual fit_api visibility', async () => {
    const f = await fixture(), p = await plan(f)
    await expect(verify(p)).rejects.toThrow('runtime_receipt')
    await expect(apply(p, false)).rejects.toThrow('backup_required')
    expect(await apply(p)).toMatchObject({ replayed: false, historyUnchanged: true, done: 21 })
    expect(await verify(p)).toMatchObject({ trainerCanReadCanonical: true, done: 21 })
    expect(await apply(p)).toMatchObject({ replayed: true, historyUnchanged: true })
    const periods = (await owner.query('select status,count(*)::int count from public.client_trainer_relationships where client_id=$1 group by status order by status', [f.card])).rows
    expect(periods).toEqual([{ status: 'active', count: 1 }, { status: 'disconnected', count: 1 }])
    const notes = (await owner.query('select note from public.client_trainers where client_id=any($1::uuid[]) and trainer_id=$2', [[f.old, f.card], f.trainerId])).rows
    expect(notes).toEqual([{ note: 'Private synthetic note' }, { note: 'Private synthetic note' }])
    expect(JSON.stringify(p.report)).not.toContain(f.athleteId)
    expect(JSON.stringify(p.report)).not.toContain('Private synthetic')
  })
  it('rejects a concurrent trainer and preserves all state without restoring a second active trainer', async () => {
    const f = await fixture(), p = await plan(f)
    await owner.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)', [f.card, f.other, f.athleteId])
    await expect(apply(p)).rejects.toThrow('other_trainer')
    expect((await owner.query('select trainer_id from public.client_trainer_relationships where client_id=$1 and status=$2', [f.card, 'active'])).rows).toEqual([{ trainer_id: f.other }])
  })
  it('does not certify another period or a lost restored membership', async () => {
    const f = await fixture(), p = await plan(f)
    await owner.query('insert into public.client_trainers(client_id,trainer_id) values($1,$2)', [f.card, f.trainerId])
    await owner.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)', [f.card, f.trainerId, f.athleteId])
    await expect(verify(p)).rejects.toThrow('runtime_receipt')
    const g = await fixture(), q = await plan(g)
    await apply(q)
    await owner.query('delete from public.client_trainers where client_id=$1 and trainer_id=$2', [g.card, g.trainerId])
    await expect(verify(q)).rejects.toThrow('runtime_receipt')
    await expect(apply(q)).rejects.toThrow('restored_membership_missing')
  })
  it('a changed result invalidates the plan and a new real disconnect cannot be undone by replay', async () => {
    const f = await fixture(), p = await plan(f)
    await owner.query('update public.workouts set notes=$2 where client_id=$1', [f.card, 'New synthetic result'])
    await expect(apply(p)).rejects.toThrow('state_changed')
    const current = await plan(f); await apply(current)
    await owner.query(`update public.client_trainer_relationships set status='disconnected',disconnected_at=now(),disconnected_by=$2 where id=$1`, [current.periodId, f.athleteId])
    await expect(apply(current)).rejects.toThrow('restored_period_ended')
    expect((await owner.query<{ count: number }>("select count(*)::int count from public.client_trainer_relationships where client_id=$1 and status='active'", [f.card])).rows[0]?.count).toBe(0)
  })
  it('rolls back even the membership insert when a later operation fails', async () => {
    const f = await fixture(), p = await plan(f), c = await owner.connect()
    try {
      await expect(applyClientRestore({ query: (sql: string, values?: unknown[]) => {
        if (typeof sql === 'string' && sql.startsWith('insert into public.client_trainer_relationships')) return Promise.reject(Error('synthetic late failure'))
        return c.query(sql, values)
      } }, p, { backupVerified: true })).rejects.toThrow('synthetic late failure')
      expect((await c.query('select client_id from public.client_trainers where client_id=$1 and trainer_id=$2', [f.card, f.trainerId])).rows).toEqual([])
    } finally { c.release() }
  })
})
