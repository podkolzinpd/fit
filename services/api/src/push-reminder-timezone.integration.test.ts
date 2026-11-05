import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { enqueueWorkoutReminders } from './push-dispatcher-command.js'

describe.skipIf(!process.env.TEST_DATABASE_URL)('reminder timezone isolation on PostgreSQL', () => {
  let admin: Pool, pool: Pool
  let created = false
  const database = `fit_push_timezone_${process.pid}`
  const now = new Date('2099-01-01T09:02:00Z')
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL ?? '')
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/fit_actor_test') {
      throw new Error('isolated_local_push_timezone_database_required')
    }
    admin = new Pool({ connectionString: url.href, max: 1 })
    await admin.query(`do $$ begin
      perform pg_advisory_xact_lock(193635,1);
      if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api; end if;
    end $$`)
    await admin.query(`create database ${database}`); created = true
    url.pathname = `/${database}`
    pool = new Pool({ connectionString: url.href, max: 2 })
    await pool.query(`create schema app_private; grant usage on schema app_private to fit_api;
      create table public.profiles(id uuid primary key,timezone text not null);
      create table public.clients(id uuid primary key,auth_user_id uuid);
      create table public.workouts(id uuid primary key,client_id uuid,status text,deleted_at timestamptz,workout_date date,start_time time);
      create table public.push_subscriptions(id uuid primary key,user_id uuid);
      create table public.notification_preferences(user_id uuid,kind text,enabled boolean,unique(user_id,kind));
      create table app_private.push_notifications_outbox(id uuid default gen_random_uuid(),kind text,user_id uuid,title text,body text,data jsonb,subscription_id uuid,
        unique(kind,user_id,data,subscription_id));`)
    const sql = (await readFile(new URL('../db/migrations/000192_push_reminder_timezone_isolation.sql', import.meta.url), 'utf8')).split('-- Down Migration')[0]
    await pool.query(`begin; ${sql} commit`)
  })
  afterAll(async () => {
    await pool?.end()
    if (created) await admin?.query(`drop database ${database}`)
    await admin?.end()
  })
  beforeEach(async () => {
    await pool.query(`truncate public.profiles,public.clients,public.workouts,public.push_subscriptions,
      public.notification_preferences,app_private.push_notifications_outbox`)
  })
  const person = async (zone = 'UTC', subscriptions = 1) => {
    const id = randomUUID(), client = randomUUID(), workout = randomUUID()
    await pool.query('insert into public.profiles values($1,$2)', [id, zone])
    await pool.query('insert into public.clients values($1,$2)', [client, id])
    await pool.query("insert into public.workouts values($1,$2,'planned',null,'2099-01-01','10:30')", [workout, client])
    for (let i = 0; i < subscriptions; i++) await pool.query('insert into public.push_subscriptions values($1,$2)', [randomUUID(), id])
    return { id, client, workout }
  }
  const prepare = async (time = now) => (await pool.query<{ result: { enqueued: number; invalidTimezoneProfiles: number } }>(
    'select app_private.prepare_workout_reminders($1) as result', [time])).rows[0]?.result
  const api = (connection: PoolClient) => ({
    query: async <Row extends QueryResultRow>(sql: string, values: readonly unknown[] = []) => (await connection.query<Row>(sql, [...values])).rows,
  })
  it('does not let an unrelated invalid profile poison valid multi-device reminders and preserves the old integer RPC', async () => {
    const valid = await person('UTC', 2)
    await pool.query('insert into public.profiles values($1,$2)', [randomUUID(), 'private-invalid-zone'])
    const before = (await pool.query('select * from public.profiles order by id')).rows
    const connection = await pool.connect()
    try {
      await connection.query('begin'); await connection.query('set local role fit_api')
      expect(await enqueueWorkoutReminders(api(connection), now)).toBe(2)
      expect((await connection.query<{ count: number }>('select app_private.enqueue_workout_reminders($1) as count', [now])).rows[0]?.count).toBe(0)
      await connection.query('commit')
    } finally { connection.release() }
    expect((await pool.query('select * from public.profiles order by id')).rows).toEqual(before)
    const outbox = (await pool.query<{ user_id: string; body: string; data: { workout_id: string } }>(
      'select user_id,body,data from app_private.push_notifications_outbox')).rows
    expect(outbox).toHaveLength(2)
    expect(outbox.every(row => row.user_id === valid.id && row.body === 'Запланирована на 10:30')).toBe(true)
    expect(outbox.every(row => row.data.workout_id === valid.workout)).toBe(true)
  })
  it('reports one eligible invalid profile across three devices without blocking valid reminders or changing profiles', async () => {
    await person('UTC', 2); await person('private-invalid-zone', 3)
    const before = (await pool.query('select * from public.profiles order by id')).rows
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const connection = await pool.connect()
    try {
      await connection.query('begin'); await connection.query('set local role fit_api')
      expect(await enqueueWorkoutReminders(api(connection), now)).toBe(2)
      expect(warn).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: 'background_push_invalid_timezone_profiles', count: 1 }))
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-')
      await connection.query('commit')
    } finally { connection.release(); warn.mockRestore() }
    expect((await pool.query('select * from public.profiles order by id')).rows).toEqual(before)
    expect(await prepare()).toEqual({ enqueued: 0, invalidTimezoneProfiles: 1 })
  })
  it.each([
    ['2099-01-01T08:59:59Z', 0], ['2099-01-01T09:00:00Z', 1],
    ['2099-01-01T09:04:59.999Z', 1], ['2099-01-01T09:05:00Z', 0], ['2099-01-02T09:02:00Z', 0],
  ])('preserves the 09:00–09:05 local date window at %s', async (time, expected) => {
    await person()
    expect(await prepare(new Date(time))).toEqual({ enqueued: expected, invalidTimezoneProfiles: 0 })
  })
  it('preserves preferences, planned/deleted status and subscription requirements', async () => {
    const disabled = await person('private-invalid-zone'), done = await person(), deleted = await person()
    await person('UTC', 0)
    await pool.query("insert into public.notification_preferences values($1,'workout_reminder',false)", [disabled.id])
    await pool.query("update public.workouts set status='done' where id=$1", [done.workout])
    await pool.query('update public.workouts set deleted_at=now() where id=$1', [deleted.workout])
    expect(await prepare()).toEqual({ enqueued: 0, invalidTimezoneProfiles: 0 })
  })
  it.each(['UTC', 'Europe/Moscow', 'EST5EDT', 'GMT+3'])('preserves PostgreSQL-supported timezone %s without a name whitelist', async zone => {
    const row = (await pool.query<{ valid: boolean }>('select app_private.push_reminder_local_time($1,$2)=pg_catalog.timezone($2,$1::timestamptz) as valid', [now, zone])).rows[0]
    expect(row?.valid).toBe(true)
  })
  it('keeps enqueue transactional and deduplicated after rollback', async () => {
    await person()
    const connection = await pool.connect()
    try {
      await connection.query('begin'); await connection.query('set local role fit_api')
      expect(await enqueueWorkoutReminders(api(connection), now)).toBe(1)
      await connection.query('rollback')
    } finally { connection.release() }
    expect((await pool.query<{ count: number }>('select count(*)::integer as count from app_private.push_notifications_outbox')).rows[0]?.count).toBe(0)
    expect(await prepare()).toEqual({ enqueued: 1, invalidTimezoneProfiles: 0 })
    expect(await prepare()).toEqual({ enqueued: 0, invalidTimezoneProfiles: 0 })
  })
  it('preserves the legacy explicit NULL clock without false invalid-profile diagnostics', async () => {
    await person()
    expect((await pool.query<{ result: unknown }>('select app_private.prepare_workout_reminders(null) as result')).rows[0]?.result)
      .toEqual({ enqueued: 0, invalidTimezoneProfiles: 0 })
    expect((await pool.query<{ count: number }>('select app_private.enqueue_workout_reminders(null) as count')).rows[0]?.count).toBe(0)
  })
  it('grants only the two producer entry points to the API role', async () => {
    const row = (await pool.query<{ prepared: boolean; legacy: boolean; helper: boolean }>(`select
      has_function_privilege('fit_api','app_private.prepare_workout_reminders(timestamptz)','execute') as prepared,
      has_function_privilege('fit_api','app_private.enqueue_workout_reminders(timestamptz)','execute') as legacy,
      has_function_privilege('fit_api','app_private.push_reminder_local_time(timestamptz,text)','execute') as helper`)).rows[0]
    expect(row).toEqual({ prepared: true, legacy: true, helper: false })
  })
})
