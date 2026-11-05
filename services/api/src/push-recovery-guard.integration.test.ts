import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('push recovery guard on isolated PostgreSQL', () => {
  let admin: Pool, pool: Pool
  let created = false
  const database = `fit_push_guard_${process.pid}`
  const now = new Date('2099-01-01T09:02:00Z')
  let migration: string
  let retainedRollback: string
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL ?? '')
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/fit_actor_test') {
      throw new Error('isolated_local_push_guard_database_required')
    }
    admin = new Pool({ connectionString: url.href, max: 1 })
    await admin.query(`do $$ begin
      perform pg_advisory_xact_lock(193635,1);
      if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api; end if;
    end $$`)
    await admin.query(`create database ${database}`); created = true
    url.pathname = `/${database}`
    pool = new Pool({ connectionString: url.href, max: 3 })
    await pool.query(`create schema app_private;
      grant usage on schema app_private to fit_api;
      create table public.push_subscriptions(id uuid primary key,endpoint text,p256dh text,auth_key text);
      create table app_private.push_notifications_outbox(
        id uuid primary key default gen_random_uuid(),subscription_id uuid,kind text not null,
        title text default 'fixture',body text default 'fixture',data jsonb default '{}',
        created_at timestamptz not null,sent_at timestamptz,discarded_at timestamptz,
        dispatch_started_at timestamptz,dispatch_token uuid,attempts integer default 0,last_error text);
      insert into public.push_subscriptions values(gen_random_uuid(),'https://push.example/fixture','public','fixture');`)
    const parts = (await readFile(new URL('../db/migrations/000191_push_recovery_fresh_guard.sql', import.meta.url), 'utf8')).split('-- Down Migration')
    migration = parts[0] ?? ''
    retainedRollback = parts[1] ?? ''
    await pool.query(`begin; ${migration} commit`)
  })
  afterAll(async () => {
    await pool?.end()
    if (created) await admin?.query(`drop database ${database}`)
    await admin?.end()
  })
  beforeEach(async () => {
    await pool.query(`truncate app_private.push_notifications_outbox;
      delete from app_private.push_delivery_control;
      insert into app_private.push_delivery_control(singleton) values(true)`)
  })
  const activate = async (boundary = new Date(now.getTime() - 60_000)) => {
    await pool.query(`update app_private.push_delivery_control
      set delivery_enabled=true,fresh_after=$1,activated_at=$2`, [boundary, now])
  }
  const add = async (kind: string, time: Date) => {
    const id = randomUUID()
    await pool.query(`insert into app_private.push_notifications_outbox(id,subscription_id,kind,created_at)
      select $1,id,$2,$3 from public.push_subscriptions limit 1`, [id, kind, time])
    return id
  }
  const claim = async (client: Pool | PoolClient = pool) =>
    (await client.query<{ batch: { dispatchToken: string; notifications: { id: string }[] } | null }>(
      'select app_private.claim_push_notifications(20,$1) as batch', [now])).rows[0]?.batch ?? null

  it('holds delivery by default and when the control row is missing, without changing history', async () => {
    await add('chat_message', now)
    const before = (await pool.query('select * from app_private.push_notifications_outbox')).rows
    expect(await claim()).toBeNull()
    await pool.query('delete from app_private.push_delivery_control')
    expect(await claim()).toBeNull()
    expect((await pool.query('select * from app_private.push_notifications_outbox')).rows).toEqual(before)
  })
  it('only claims events at/after activation boundary, preserving history and generic kinds', async () => {
    const old = await add('chat_message', new Date(now.getTime() - 120_000))
    const fresh = await add('chat_message', now)
    const generic = await add('retry_limit_test', now)
    await activate()
    const batch = await claim()
    expect(batch?.notifications.map(row => row.id).sort()).toEqual([fresh, generic].sort())
    expect((await pool.query<{ dispatch_token: string | null }>('select dispatch_token from app_private.push_notifications_outbox where id=$1', [old])).rows[0]?.dispatch_token).toBeNull()
    expect(await claim()).toBeNull()
  })
  it.each(['test', 'workout_reminder', 'chat_message', 'workout_scheduled', 'custom_kind'])('excludes expired %s even after activation', async kind => {
    await activate(new Date(now.getTime() - 3 * 86_400_000))
    const lifetime = ['test', 'workout_reminder'].includes(kind) ? 900_000 : 86_400_000
    const expired = await add(kind, new Date(now.getTime() - lifetime - 1))
    const fresh = await add(kind, new Date(now.getTime() - lifetime + 1))
    expect((await claim())?.notifications.map(row => row.id)).toEqual([fresh])
    expect((await pool.query('select sent_at,discarded_at,dispatch_token from app_private.push_notifications_outbox where id=$1', [expired])).rows[0])
      .toEqual({ sent_at: null, discarded_at: null, dispatch_token: null })
  })
  it('keeps skip-locked concurrency and does not duplicate a claim', async () => {
    await activate()
    await add('test', now)
    const first = await pool.connect(), second = await pool.connect()
    try {
      await first.query('begin'); await second.query('begin')
      expect((await claim(first))?.notifications).toHaveLength(1)
      expect(await claim(second)).toBeNull()
      await first.query('rollback'); await second.query('rollback')
      expect((await claim())?.notifications).toHaveLength(1)
    } finally { first.release(); second.release() }
  })
  it('serializes maintenance against a claim until the delivery transaction finishes', async () => {
    await activate(); await add('test', now)
    const first = await pool.connect(), second = await pool.connect()
    try {
      await first.query('begin'); await claim(first)
      await second.query('begin'); await second.query("set local lock_timeout='50ms'")
      await expect(second.query('update app_private.push_delivery_control set delivery_enabled=false')).rejects.toMatchObject({ code: '55P03' })
      await second.query('rollback'); await first.query('rollback')
    } finally { first.release(); second.release() }
  })
  it('preserves stale-lease retries and the tenth-attempt stop', async () => {
    await activate(new Date(now.getTime() - 60 * 60_000))
    const id = await add('chat_message', now)
    await pool.query(`update app_private.push_notifications_outbox set attempts=9,
      dispatch_token=gen_random_uuid(),dispatch_started_at=$1 where id=$2`, [new Date(now.getTime() - 11 * 60_000), id])
    expect(await claim()).toBeNull()
    expect((await pool.query('select attempts,discarded_at,last_error from app_private.push_notifications_outbox where id=$1', [id])).rows[0])
      .toEqual({ attempts: 10, discarded_at: now, last_error: 'dispatch_timeout' })
  })
  it('prevents the API role from opening or modifying the owner-only boundary', async () => {
    const connection = await pool.connect()
    try {
      await connection.query('begin'); await connection.query('set local role fit_api')
      await expect(connection.query('update app_private.push_delivery_control set delivery_enabled=true')).rejects.toMatchObject({ code: '42501' })
      await connection.query('rollback')
    } finally { connection.release() }
  })
  it('refuses the recovery migration while any delivery outcome is uncertain', async () => {
    const id = await add('test', now)
    await pool.query('update app_private.push_notifications_outbox set dispatch_token=gen_random_uuid() where id=$1', [id])
    const connection = await pool.connect()
    try {
      await connection.query('begin')
      await expect(connection.query(migration)).rejects.toMatchObject({ code: 'PT409' })
      await connection.query('rollback')
      expect((await pool.query<{ leased: boolean }>('select dispatch_token is not null as leased from app_private.push_notifications_outbox where id=$1', [id])).rows[0]?.leased).toBe(true)
    } finally { connection.release() }
  })
  it('retains the protection and exact active boundary through rollback and reapplication', async () => {
    await activate()
    await add('chat_message', new Date(now.getTime() - 120_000))
    const fresh = await add('chat_message', now)
    await pool.query(`update app_private.push_delivery_control
      set history_fingerprint=$1,history_cutoff=fresh_after`, ['a'.repeat(64)])
    const before = (await pool.query('select * from app_private.push_delivery_control')).rows
    await pool.query(retainedRollback)
    expect((await pool.query('select * from app_private.push_delivery_control')).rows).toEqual(before)
    await pool.query(`begin; ${migration} commit`)
    expect((await pool.query('select * from app_private.push_delivery_control')).rows).toEqual(before)
    expect((await claim())?.notifications.map(row => row.id)).toEqual([fresh])
  })
})
