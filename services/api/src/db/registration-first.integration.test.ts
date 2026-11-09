import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { runner } from 'node-pg-migrate'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
const source = process.env.TEST_DATABASE_URL
const database = `fit_registration_first_${process.pid}`
describe.skipIf(!source)('registration and consent before new coaching work', () => {
  let admin: Pool, pool: Pool
  beforeAll(async () => {
    const url = new URL(source!)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/fit_actor_test') throw Error('local_test_database_required')
    admin = new Pool({ connectionString: url.href })
    await admin.query("do $$ begin perform pg_advisory_xact_lock(193635,1); if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api login; end if; end $$")
    await admin.query(`create database ${database}`)
    url.pathname = `/${database}`
    await runner({ databaseUrl: url.href, dir: fileURLToPath(new URL('../../db/migrations', import.meta.url)), direction: 'up', migrationsTable: 'fit_migrations', migrationsSchema: 'app_private', createMigrationsSchema: true, verbose: false, log: () => {} })
    pool = new Pool({ connectionString: url.href })
  }, 60000)
  afterAll(async () => { await pool?.end(); if (admin) { await admin.query(`drop database if exists ${database}`); await admin.end() } })
  async function actor(id: string, sql: string, params: unknown[] = []) {
    const db = await pool.connect()
    try {
      await db.query('begin')
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id])
      await db.query('set local role fit_api')
      const result = await db.query<Record<string, unknown>>(sql, params)
      await db.query('commit'); return result.rows
    } catch (error) { await db.query('rollback'); throw error } finally { db.release() }
  }
  async function fixture(registered: boolean, connected = false) {
    const trainer = randomUUID(), athlete = randomUUID(), card = randomUUID()
    await pool.query("insert into public.profiles(id,account_role,first_name) values($1,'trainer','Synthetic Trainer'),($2,'client','Synthetic Athlete')", [trainer, athlete])
    await pool.query('insert into public.trainers(profile_id) values($1)', [trainer])
    await pool.query("insert into public.clients(id,trainer_id,auth_user_id,full_name) values($1,$2,$3,'Synthetic historical card')", [card, trainer, registered ? athlete : null])
    await pool.query('insert into public.client_trainers(client_id,trainer_id) values($1,$2)', [card, trainer])
    if (connected) await pool.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)', [card, trainer, athlete])
    return { trainer, athlete, card }
  }
  const planned = (clientId: string) => ({ clientId, workoutDate: '2026-11-07', exercises: [] })
  const settle = async (operation: Promise<unknown>) => {
    try { await operation; return { error: null } } catch (error) { return { error } }
  }
  async function waitBlocked(pid: number, blocker: number) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if ((await pool.query<{ blocked: boolean }>('select $2=any(pg_blocking_pids($1)) blocked', [pid, blocker])).rows[0]!.blocked) return
      await delay(10)
    }
    throw Error('expected_database_lock_not_observed')
  }
  it('restores trainer-owned manual cards and keeps new invitation creation available', async () => {
    const f = await fixture(false)
    const [created] = await actor(f.trainer, 'select * from public.create_client_card($1)', [{ fullName: 'Unknown Athlete' }])
    expect(created!.client_id).toBeTruthy()
    expect(await actor(f.trainer, 'select public.can_create_client_workout($1) allowed', [created!.client_id])).toEqual([{ allowed: true }])
    expect(await actor(f.trainer, 'select * from public.create_new_client_invitation_share($1,$2)', ['Unknown Athlete', randomUUID()])).toHaveLength(1)
    for (const sql of ['select * from public.save_planned_workout($1,null)', 'select * from public.save_completed_workout($1,null)']) {
      expect(await actor(f.trainer, sql, [planned(String(created!.client_id))])).toHaveLength(1)
    }
    expect(await actor(f.trainer, 'select * from public.quick_start_live_workout($1,$2)', [created!.client_id, randomUUID()])).toHaveLength(1)
  })
  it('never lets another trainer create workouts for an unclaimed manual card', async () => {
    const f = await fixture(false), other = await fixture(false)
    expect(await actor(other.trainer, 'select public.can_create_client_workout($1) allowed', [f.card])).toEqual([{ allowed: false }])
    await expect(actor(other.trainer, 'select * from public.quick_start_live_workout($1,$2)', [f.card, randomUUID()])).rejects.toMatchObject({ message: 'athlete_connection_required' })
  })
  it('shares all earlier trainers’ workouts only with relationship-scoped athlete consent, read-only', async () => {
    const f = await fixture(true, true), second = await fixture(false), third = await fixture(false)
    const historical = randomUUID(), secondHistory = randomUUID()
    await pool.query("insert into public.workouts(id,trainer_id,client_id,created_by,workout_date,status,completed_at) values($1,$2,$3,$2,'2026-01-01','done',now()),($4,$2,$3,$5,'2026-02-01','done',now())", [historical,f.trainer,f.card,secondHistory,third.trainer])
    const directory = (who: string, action: string, data = {}) => actor(who, 'select app_private.connection_directory($1,$2) result', [action,data])
    const [preview] = await directory(f.athlete,'preview',{peerId:second.trainer})
    const consent = preview!.result as Record<string,unknown>
    const [sent] = await directory(f.athlete,'send',{peerId:second.trainer,...consent,shareHistory:true})
    const request = sent!.result as { id:string }
    await directory(second.trainer,'accept',{requestId:request.id,expectedRelationshipId:null,expectedRevision:null,shareHistory:false})
    expect(await actor(second.trainer,'select id from public.workouts where client_id=$1 order by workout_date',[f.card])).toEqual([{id:historical},{id:secondHistory}])
    // A later import of an old workout is still part of the shared history.
    const lateHistory = randomUUID()
    await pool.query("insert into public.workouts(id,trainer_id,client_id,created_by,workout_date,status,completed_at) values($1,$2,$3,$4,'2025-01-01','done',now())",[lateHistory,f.trainer,f.card,third.trainer])
    expect(await actor(second.trainer,'select id from public.workouts where id=$1',[lateHistory])).toEqual([{id:lateHistory}])
    await expect(actor(second.trainer,'select public.set_workout_actual_duration($1,600,1)',[historical])).rejects.toMatchObject({message:'workout_forbidden'})
    await expect(actor(second.trainer,'select * from public.save_completed_workout($1,1)',[{...planned(f.card),id:historical}])).rejects.toMatchObject({message:'workout_forbidden'})
    const [access] = await directory(f.athlete,'history_access')
    const current = access!.result as {relationshipId:string;enabled:boolean}
    expect(current.enabled).toBe(true)
    await expect(directory(second.trainer,'set_history_access',{relationshipId:current.relationshipId,shareHistory:true})).rejects.toMatchObject({message:'connection_forbidden'})
    await directory(f.athlete,'set_history_access',{relationshipId:current.relationshipId,shareHistory:false})
    expect(await actor(second.trainer,'select id from public.workouts where client_id=$1',[f.card])).toEqual([])
    // A replay of the trainer's acceptance cannot restore revoked access.
    await directory(second.trainer,'accept',{requestId:request.id,expectedRelationshipId:null,expectedRevision:null})
    expect(await actor(second.trainer,'select id from public.workouts where client_id=$1',[f.card])).toEqual([])
    await directory(f.athlete,'set_history_access',{relationshipId:current.relationshipId,shareHistory:true})
    expect(await actor(second.trainer,'select id from public.workouts where client_id=$1',[f.card])).toHaveLength(3)
    await actor(f.athlete,'select public.remove_client_trainer($1,$2)',[f.card,second.trainer])
    expect(await actor(second.trainer,'select id from public.workouts where client_id=$1',[f.card])).toEqual([])
    const [next] = await directory(f.athlete,'preview',{peerId:third.trainer})
    const [nextRequest] = await directory(f.athlete,'send',{peerId:third.trainer,...next!.result as object,shareHistory:false})
    await directory(third.trainer,'accept',{requestId:(nextRequest!.result as {id:string}).id,expectedRelationshipId:null,expectedRevision:null,shareHistory:true})
    expect(await actor(third.trainer,'select id from public.workouts where client_id=$1 order by workout_date',[f.card])).toEqual([{id:lateHistory},{id:secondHistory}])
    await expect(directory(f.athlete,'set_history_access',{relationshipId:current.relationshipId,shareHistory:true})).rejects.toMatchObject({message:'connection_changed'})
    expect((await pool.query('select id from public.workouts where client_id=$1',[f.card])).rows).toHaveLength(3)
  })
  it('can share only independent history and revoke it without exposing previous coaches’ sessions', async () => {
    const f = await fixture(true,true), next = await fixture(false)
    const solo = randomUUID(), coached = randomUUID()
    await pool.query("insert into public.workouts(id,trainer_id,client_id,created_by,workout_date,status,completed_at,training_format) values($1,$2,$3,$4,'2026-01-01','done',now(),'self'),($5,$2,$3,$2,'2026-01-02','done',now(),'with_trainer')",[solo,f.trainer,f.card,f.athlete,coached])
    const directory = (who: string, action: string, data = {}) => actor(who,'select app_private.connection_directory($1,$2) result',[action,data])
    const [preview] = await directory(f.athlete,'preview',{peerId:next.trainer})
    const [sent] = await directory(f.athlete,'send',{peerId:next.trainer,...preview!.result as object,shareHistory:false,shareSoloHistory:true})
    await directory(next.trainer,'accept',{requestId:(sent!.result as {id:string}).id,expectedRelationshipId:null,expectedRevision:null})
    expect(await actor(next.trainer,'select id from public.workouts where client_id=$1',[f.card])).toEqual([{id:solo}])
    const [access] = await directory(f.athlete,'history_access')
    const permission = access!.result as {relationshipId:string;soloEnabled:boolean}
    expect(permission.soloEnabled).toBe(true)
    await directory(f.athlete,'set_history_access',{relationshipId:permission.relationshipId,shareHistory:false,shareSoloHistory:false})
    expect(await actor(next.trainer,'select id from public.workouts where client_id=$1',[f.card])).toEqual([])
    await directory(f.athlete,'set_history_access',{relationshipId:permission.relationshipId,shareHistory:true,shareSoloHistory:false})
    expect(await actor(next.trainer,'select id from public.workouts where client_id=$1',[f.card])).toHaveLength(2)
    expect(await actor(f.athlete,'select id from public.workouts where client_id=$1',[f.card])).toHaveLength(2)
  })
  it('allows the registered athlete to create their own card and workout', async () => {
    const f = await fixture(false)
    const [created] = await actor(f.athlete, 'select * from public.create_quick_own_client_card($1)', ['Synthetic Athlete'])
    expect(await actor(f.athlete, 'select public.can_create_client_workout($1) allowed', [created!.client_id])).toEqual([{ allowed: true }])
    expect(await actor(f.athlete, 'select * from public.save_planned_workout($1,null)', [planned(String(created!.client_id))])).toHaveLength(1)
  })
  it('rejects new plans, results and Live for a registered athlete without consent', async () => {
    const registered = true
    const f = await fixture(registered)
    expect(await actor(f.trainer, 'select public.can_create_client_workout($1) allowed', [f.card])).toEqual([{ allowed: false }])
    for (const sql of ['select * from public.save_planned_workout($1,null)', 'select * from public.save_completed_workout($1,null)']) await expect(actor(f.trainer, sql, [planned(f.card)])).rejects.toMatchObject({ message: registered ? 'workout_forbidden' : 'athlete_connection_required' })
    await expect(actor(f.trainer, 'select * from public.quick_start_live_workout($1,$2)', [f.card, randomUUID()])).rejects.toMatchObject({ message: 'athlete_connection_required' })
    const workout = randomUUID()
    await pool.query("insert into public.workouts(id,trainer_id,client_id,created_by,workout_date,status) values($1,$2,$3,$2,current_date,'planned')", [workout, f.trainer, f.card])
    await expect(actor(f.trainer, 'select * from public.start_live_workout($1,1,$2)', [workout, randomUUID()])).rejects.toMatchObject({ message: 'athlete_connection_required' })
    expect((await pool.query('select status from public.workouts where id=$1', [workout])).rows).toEqual([{ status: 'planned' }])
  })
  it('permits connected coaching and blocks new sessions after disconnection', async () => {
    const f = await fixture(true, true)
    expect(await actor(f.trainer, 'select public.can_create_client_workout($1) allowed', [f.card])).toEqual([{ allowed: true }])
    const [plan] = await actor(f.trainer, 'select * from public.save_planned_workout($1,null)', [planned(f.card)])
    expect(await actor(f.trainer, 'select * from public.start_live_workout($1,$2,$3)', [plan!.workout_id, plan!.version, randomUUID()])).toHaveLength(1)
    await actor(f.athlete, 'select public.remove_client_trainer($1,$2)', [f.card, f.trainer])
    expect(await actor(f.trainer, 'select public.can_create_client_workout($1) allowed', [f.card])).toEqual([{ allowed: false }])
    await expect(actor(f.trainer, 'select * from public.quick_start_live_workout($1,$2)', [f.card, randomUUID()])).rejects.toMatchObject({ message: 'athlete_connection_required' })
  })
  it('serializes quick completion against Live start without reversing client/workout locks', async () => {
    const f = await fixture(true, true)
    const [plan] = await actor(f.trainer, 'select * from public.save_planned_workout($1,null)', [{ ...planned(f.card), workoutDate: new Date().toISOString().slice(0, 10) }])
    const gate = await pool.connect(), completion = await pool.connect(), start = await pool.connect()
    let finishing: ReturnType<typeof settle> | undefined, starting: ReturnType<typeof settle> | undefined
    try {
      // Pause after completion owns the workout but before the registration row
      // trigger, so a competing start exposes any client/workout lock inversion.
      await pool.query(`create function app_private.test_completion_barrier() returns trigger language plpgsql as $$
        begin if new.id='${String(plan!.workout_id)}'::uuid and old.status='planned' and new.status='done' then
          perform pg_advisory_xact_lock(199,77); end if; return new; end $$;
        create trigger aa_test_completion_barrier before update of status on public.workouts
          for each row execute function app_private.test_completion_barrier()`)
      await gate.query('begin')
      await gate.query('select pg_advisory_xact_lock(199,77)')
      for (const db of [completion, start]) {
        await db.query('begin')
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [f.trainer])
        await db.query('set local role fit_api')
      }
      const gatePid = (await gate.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]!.pid
      const completionPid = (await completion.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]!.pid
      const startPid = (await start.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]!.pid
      finishing = settle(completion.query('select * from public.finish_live_workout($1,$2,$3,true,\'auto\',null)', [plan!.workout_id, plan!.version, randomUUID()]))
      await waitBlocked(completionPid, gatePid)
      starting = settle(start.query('select * from public.start_live_workout($1,$2,$3)', [plan!.workout_id, plan!.version, randomUUID()]))
      await waitBlocked(startPid, completionPid)
      await gate.query('commit')
      expect((await finishing).error).toBeNull()
      await completion.query('commit')
      expect((await starting).error).toMatchObject({ message: 'workout_conflict', code: 'PT409' })
      await start.query('rollback')
      expect((await pool.query('select status,version from public.workouts where id=$1', [plan!.workout_id])).rows).toEqual([{ status: 'done', version: '2' }])
    } finally {
      await gate.query('rollback')
      if (finishing) await finishing
      await completion.query('rollback')
      if (starting) await starting
      await start.query('rollback')
      gate.release(); completion.release(); start.release()
      await pool.query('drop trigger if exists aa_test_completion_barrier on public.workouts; drop function if exists app_private.test_completion_barrier()')
    }
  })
  it('rechecks consent after a concurrent disconnect releases the client lock', async () => {
    const f = await fixture(true, true)
    const [plan] = await actor(f.trainer, 'select * from public.save_planned_workout($1,null)', [planned(f.card)])
    const disconnect = await pool.connect(), start = await pool.connect()
    let starting: ReturnType<typeof settle> | undefined
    try {
      for (const [db, id] of [[disconnect, f.athlete], [start, f.trainer]] as const) {
        await db.query('begin')
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id])
        await db.query('set local role fit_api')
      }
      const disconnectPid = (await disconnect.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]!.pid
      const startPid = (await start.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]!.pid
      await disconnect.query('select public.remove_client_trainer($1,$2)', [f.card, f.trainer])
      starting = settle(start.query('select * from public.start_live_workout($1,$2,$3)', [plan!.workout_id, plan!.version, randomUUID()]))
      await waitBlocked(startPid, disconnectPid)
      await disconnect.query('commit')
      expect((await starting).error).toMatchObject({ message: 'athlete_connection_required' })
      expect((await pool.query('select status,version from public.workouts where id=$1', [plan!.workout_id])).rows).toEqual([{ status: 'planned', version: '1' }])
    } finally {
      await disconnect.query('rollback')
      if (starting) await starting
      await start.query('rollback')
      disconnect.release(); start.release()
    }
  })
  it('preserves reading, correcting and deleting pre-existing manual history', async () => {
    const f = await fixture(false), workout = randomUUID()
    await pool.query("insert into public.workouts(id,trainer_id,client_id,created_by,workout_date,status,completed_at,notes) values($1,$2,$3,$2,current_date,'done',now(),'Historical note')", [workout, f.trainer, f.card])
    expect(await actor(f.trainer, 'select notes from public.workouts where id=$1', [workout])).toEqual([{ notes: 'Historical note' }])
    const [updated] = await actor(f.trainer, 'select * from public.save_completed_workout($1,1)', [{ ...planned(f.card), id: workout, notes: 'Corrected history' }])
    expect(await actor(f.trainer, 'select notes from public.workouts where id=$1', [workout])).toEqual([{ notes: 'Corrected history' }])
    expect(await actor(f.trainer, 'select public.soft_delete_workout($1,$2)', [workout, updated!.version])).toHaveLength(1)
    expect((await pool.query<{ deleted_at: Date | null }>('select deleted_at from public.workouts where id=$1', [workout])).rows[0]!.deleted_at).not.toBeNull()
  })
})
