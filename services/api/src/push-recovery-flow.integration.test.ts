import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runner } from 'node-pg-migrate'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { activateCloudruFreshPush, archiveCloudruPushSnapshot, previewCloudruPushHistory } from './cloudru-background-cutover.js'
import { claimPushNotifications, finalizePushNotifications } from './push-dispatcher-command.js'
import type { DatabaseClient } from './db/types.js'

describe.skipIf(!process.env.TEST_DATABASE_URL)('verified recovery with the complete PostgreSQL schema', () => {
  let admin: Pool, pool: Pool
  let created = false
  const database = `fit_push_recovery_flow_${process.pid}`
  const profile = randomUUID(), subscription = randomUUID()
  const oldTest = randomUUID(), oldChat = randomUUID(), oldSent = randomUUID(), fresh = randomUUID()
  const cutoff = new Date('2099-01-01T09:00:00Z'), now = new Date('2099-01-01T09:01:00Z')
  const wrap = (connection: PoolClient): DatabaseClient => ({
    query: async <Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) =>
      (await connection.query<Row>(text, [...values])).rows,
  })
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL ?? '')
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/fit_actor_test') throw new Error('isolated_local_recovery_flow_required')
    admin = new Pool({ connectionString: url.href, max: 1 })
    await admin.query(`do $$ begin
      perform pg_advisory_xact_lock(193635,1);
      if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api; end if;
    end $$`)
    await admin.query(`create database ${database}`); created = true
    url.pathname = `/${database}`
    await runner({ databaseUrl: url.href, dir: fileURLToPath(new URL('../db/migrations', import.meta.url)),
      direction: 'up', migrationsTable: 'fit_migrations', migrationsSchema: 'app_private',
      createMigrationsSchema: true, verbose: false, log: () => {} })
    pool = new Pool({ connectionString: url.href, max: 2 })
    await pool.query("insert into public.profiles(id,first_name,account_role,timezone) values($1,'Synthetic recovery','client','UTC')", [profile])
    await pool.query(`insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth_key)
      values($1,$2,'https://push.example/recovery-fixture','synthetic-public','synthetic-auth')`, [subscription, profile])
    for (const [id, kind, createdAt, sentAt] of [
      [oldTest, 'test', '2098-12-31T09:00:00Z', null],
      [oldChat, 'chat_message', '2098-12-31T09:00:00Z', null],
      [oldSent, 'workout_scheduled', '2098-12-31T09:00:00Z', '2098-12-31T09:01:00Z'],
      [fresh, 'test', '2099-01-01T09:00:30Z', null],
    ] as const) {
      await pool.query(`insert into app_private.push_notifications_outbox
        (id,user_id,subscription_id,kind,title,body,data,created_at,sent_at)
        values($1,$2,$3,$4,'Synthetic recovery','Synthetic recovery',$5::jsonb,$6,$7)`,
      [id, profile, subscription, kind, JSON.stringify({ fixture: id }), createdAt, sentAt])
    }
  })
  afterAll(async () => {
    await pool?.end()
    if (created) await admin?.query(`drop database ${database}`)
    await admin?.end()
  })
  it('preserves history, activates once, and leases/finalizes only the new event through the API role', async () => {
    const connection = await pool.connect(), client = wrap(connection)
    try {
      const sourcesBefore = (await connection.query(`select
        (select jsonb_agg(to_jsonb(p)) from public.profiles p) profiles,
        (select jsonb_agg(to_jsonb(s)) from public.push_subscriptions s) subscriptions`)).rows
      const outboxBefore = (await connection.query<Record<string, unknown>>('select * from app_private.push_notifications_outbox order by id')).rows
      expect(await claimPushNotifications(client, now)).toBeNull()
      const snapshot = await previewCloudruPushHistory(client, cutoff)
      expect(snapshot).toMatchObject({ pending: 2, leased: 0, byKind: { tests: 1, chat: 1 } })
      expect(await archiveCloudruPushSnapshot(client, cutoff, snapshot.fingerprint)).toMatchObject({ archived: 2, replayed: false })
      expect(await archiveCloudruPushSnapshot(client, cutoff, snapshot.fingerprint)).toMatchObject({ archived: 0, replayed: true, previouslyArchived: 2 })
      expect(await activateCloudruFreshPush(client, cutoff, snapshot.fingerprint, now)).toMatchObject({ activated: true, preserved: 2 })

      await connection.query('begin'); await connection.query('set local role fit_api')
      const batch = await claimPushNotifications(client, now)
      expect(batch?.notifications.map(item => item.id)).toEqual([fresh])
      if (!batch) throw new Error('fresh_fixture_not_claimed')
      await connection.query('commit')
      await connection.query('begin'); await connection.query('set local role fit_api')
      expect(await finalizePushNotifications(client, batch.dispatchToken, [{ id: fresh, ok: true }], now))
        .toEqual({ succeeded: 1, failed: 0, discarded: 0 })
      await connection.query('commit')
      expect(await claimPushNotifications(client, now)).toBeNull()
      expect(await activateCloudruFreshPush(client, cutoff, snapshot.fingerprint, now)).toMatchObject({ alreadyActive: true })

      const after = (await connection.query<Record<string, unknown>>('select * from app_private.push_notifications_outbox order by id')).rows
      for (const id of [oldTest, oldChat]) {
        const original = outboxBefore.find(row => row.id === id)
        const preserved = after.find(row => row.id === id)
        expect(preserved?.discarded_at).toBeInstanceOf(Date)
        expect(preserved?.last_error).toBe(`cloudru_recovery_history_preserved:${snapshot.fingerprint}`)
        expect({ ...preserved, discarded_at: null, last_error: null }).toEqual(original)
      }
      expect(after.find(row => row.id === oldSent)).toEqual(outboxBefore.find(row => row.id === oldSent))
      expect(after.find(row => row.id === fresh)).toMatchObject({ sent_at: now, discarded_at: null, dispatch_token: null })
      expect((await connection.query(`select
        (select jsonb_agg(to_jsonb(p)) from public.profiles p) profiles,
        (select jsonb_agg(to_jsonb(s)) from public.push_subscriptions s) subscriptions`)).rows).toEqual(sourcesBefore)
    } finally { await connection.query('rollback'); connection.release() }
  })
})
