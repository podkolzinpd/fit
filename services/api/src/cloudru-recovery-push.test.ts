import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'

import { PgDatabasePool } from './db/pg-pool.js'
import { DirectRecoveryPushSender, recoveryCampaign, runRecovery } from './cloudru-recovery-push.js'
import type { PushNotificationInput } from './push-notifications/send.js'

const providerSend = vi.hoisted(() => vi.fn())
vi.mock('web-push', () => ({ default: { sendNotification: (...args: unknown[]): unknown => providerSend(...args) } }))

describe('approved recovery copy', () => {
  it('keeps the complete main message short and opens the canonical app root', () => {
    expect(recoveryCampaign.title).toBe('ФИТ снова работает 💪')
    expect(recoveryCampaign.body).toBe('Всё починили. Возвращайтесь к тренировкам!')
    expect([...recoveryCampaign.title].length).toBeLessThan(30)
    expect([...recoveryCampaign.body].length).toBeLessThan(50)
    expect(JSON.parse(recoveryCampaign.data)).toEqual({ announcement: 'cloudru_recovery_2026_10_14', url: '/' })
  })

  it('uses existing VAPID identity, bounds provider calls and preserves exact payload', async () => {
    providerSend.mockReset().mockResolvedValueOnce(undefined)
    const item: PushNotificationInput = { id: 'test', subscription: {
      endpoint: 'https://push.example/test', keys: { p256dh: 'test-key', auth: 'test-auth' } },
    title: recoveryCampaign.title, body: recoveryCampaign.body, data: { url: '/' } }
    const vapid = { publicKey: 'test-public', privateKey: 'test-private', subject: 'mailto:test@example.test' }
    expect(await new DirectRecoveryPushSender(vapid).send([item])).toEqual([{ id: 'test', ok: true }])
    expect(providerSend).toHaveBeenCalledWith(item.subscription,
      JSON.stringify({ title: item.title, body: item.body, data: item.data }),
      { vapidDetails: vapid, timeout: 10_000 })
  })

  it('does not expose provider errors and distinguishes HTTP rejection from uncertain socket outcome', async () => {
    providerSend.mockReset().mockRejectedValueOnce({ statusCode: 410, body: 'private provider body' })
      .mockRejectedValueOnce(new Error('private endpoint socket timeout'))
    const item: PushNotificationInput = { id: 'test', subscription: {
      endpoint: 'https://push.example/test', keys: { p256dh: 'test-key', auth: 'test-auth' } },
    title: 'Test', body: 'Test', data: {} }
    const sender = new DirectRecoveryPushSender({ publicKey: 'test', privateKey: 'test', subject: 'test' })
    expect(await sender.send([item, { ...item, id: 'timeout' }])).toEqual([
      { id: 'test', ok: false, status: 410, error: 'web_push_410' },
      { id: 'timeout', ok: false, status: 0, error: 'delivery_outcome_unknown' },
    ])
  })
})

describe.skipIf(!process.env.TEST_RECOVERY_DATABASE_URL)('recovery push on isolated PostgreSQL', () => {
  let admin: Pool
  let pool: PgDatabasePool
  const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  const devices = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  beforeAll(async () => {
    const url = new URL(process.env.TEST_RECOVERY_DATABASE_URL ?? '')
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/fit_recovery_test'
      || url.username !== 'fit_owner') throw new Error('isolated local recovery DB required')
    admin = new Pool({ connectionString: url.href })
    pool = new PgDatabasePool({ connectionString: url.href, max: 1 })
    // Isolated fixture matches the deployed outbox/subscription column and
    // uniqueness contract. Reuse the actual deployed multi-device finalizer.
    await admin.query(`drop schema if exists app_private cascade;
      drop schema public cascade; create schema public; create schema app_private;
      create table public.profiles(id uuid primary key);
      create table public.push_subscriptions(id uuid primary key, user_id uuid references public.profiles,
        endpoint text, p256dh text, auth_key text);
      create table public.notification_preferences(user_id uuid, kind text, enabled boolean,
        primary key(user_id,kind));
      create table app_private.push_notifications_outbox(id uuid primary key default gen_random_uuid(),
        kind text not null, user_id uuid references public.profiles, title text not null, body text not null,
        data jsonb not null, subscription_id uuid, dispatch_started_at timestamptz, dispatch_token uuid,
        discarded_at timestamptz, sent_at timestamptz, attempts smallint not null default 0, last_error text,
        created_at timestamptz default now(), unique(kind,user_id,data,subscription_id));`)
    const migration = await readFile(new URL('../db/migrations/000038_push_subscriptions_multi_device.sql', import.meta.url), 'utf8')
    const start = migration.indexOf('create or replace function app_private.finalize_push_notifications(')
    const end = migration.indexOf('\n$$;', start) + 4
    await admin.query(migration.slice(start, end))
  })
  afterAll(async () => {
    await pool?.end()
    await admin?.end()
  })
  beforeEach(async () => {
    await admin.query('truncate app_private.push_notifications_outbox, public.notification_preferences, public.push_subscriptions, public.profiles cascade')
    for (const user of users) await admin.query('insert into public.profiles values($1)', [user])
    for (const [index, device] of devices.entries()) {
      await admin.query('insert into public.push_subscriptions values($1,$2,$3,$4,$5)',
        [device, users[index < 2 ? 0 : index - 1], `https://push.example/${device}`, 'test-public', 'test-auth'])
    }
    for (const kind of ['workout_reminder', 'workout_scheduled', 'chat_message']) {
      await admin.query('insert into public.notification_preferences values($1,$2,false)', [users[1], kind])
    }
  })

  it('inspects without mutation, filters all-disabled users and queues once per device across repeats', async () => {
    expect(await runRecovery(pool, 'inspect')).toMatchObject({ eligibleUsers: 3, eligibleSubscriptions: 4, queued: 0 })
    expect(await runRecovery(pool, 'enqueue')).toMatchObject({ inserted: 4, queued: 4 })
    expect(await runRecovery(pool, 'enqueue')).toMatchObject({ inserted: 0, queued: 4 })
    const copies = await admin.query('select distinct title,body,data from app_private.push_notifications_outbox')
    expect(copies.rows).toEqual([{ title: recoveryCampaign.title, body: recoveryCampaign.body,
      data: JSON.parse(recoveryCampaign.data) as unknown }])
  })

  it('sends only the new campaign and never resends confirmed deliveries', async () => {
    await runRecovery(pool, 'enqueue')
    await admin.query(`insert into app_private.push_notifications_outbox(kind,user_id,title,body,data,subscription_id)
      values('old_campaign',$1,'old','old','{}',$2)`, [users[0], devices[0]])
    const send = vi.fn((items: readonly PushNotificationInput[]) => Promise.resolve(items.map(item => ({ id: item.id, ok: true as const }))))
    expect(await runRecovery(pool, 'dispatch', { send })).toMatchObject({ sent: 4, pending: 0 })
    await runRecovery(pool, 'dispatch', { send })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toHaveLength(4)
    const old = await admin.query("select sent_at,dispatch_token from app_private.push_notifications_outbox where kind='old_campaign'")
    expect(old.rows).toEqual([{ sent_at: null, dispatch_token: null }])
  })

  it('deletes only an expired endpoint and records provider failures without retrying them', async () => {
    await runRecovery(pool, 'enqueue')
    const send = vi.fn((items: readonly PushNotificationInput[]) => Promise.resolve(items.map(item =>
      item.subscription.endpoint.endsWith(devices[0]!)
        ? { id: item.id, ok: false as const, status: 410, error: 'web_push_410' }
        : { id: item.id, ok: true as const })))
    expect(await runRecovery(pool, 'dispatch', { send })).toMatchObject({ sent: 3, discarded: 1 })
    const siblings = await admin.query<{ count: number }>('select count(*)::int as count from public.push_subscriptions where user_id=$1', [users[0]])
    expect(siblings.rows[0]?.count).toBe(1)
    await runRecovery(pool, 'dispatch', { send })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('leaves unknown transport outcomes leased and does not automatically resend', async () => {
    await runRecovery(pool, 'enqueue')
    const send = vi.fn(() => Promise.reject(new Error('simulated timeout')))
    await expect(runRecovery(pool, 'dispatch', { send })).rejects.toThrow('simulated timeout')
    expect(await runRecovery(pool, 'inspect')).toMatchObject({ uncertain: 4, sent: 0 })
    await runRecovery(pool, 'dispatch', { send })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('respects removal and opt-out between enqueue and dispatch', async () => {
    await runRecovery(pool, 'enqueue')
    await admin.query('delete from public.push_subscriptions where id=$1', [devices[0]])
    for (const kind of ['workout_reminder', 'workout_scheduled', 'chat_message']) {
      await admin.query('insert into public.notification_preferences values($1,$2,false)', [users[2], kind])
    }
    const send = vi.fn((items: readonly PushNotificationInput[]) => Promise.resolve(items.map(item => ({ id: item.id, ok: true as const }))))
    expect(await runRecovery(pool, 'dispatch', { send })).toMatchObject({ sent: 2, discarded: 2, pending: 0 })
  })

  it('records transient provider failures and leaves them for diagnosis instead of immediate retry', async () => {
    await runRecovery(pool, 'enqueue')
    const send = vi.fn((items: readonly PushNotificationInput[]) => Promise.resolve(items.map(item =>
      ({ id: item.id, ok: false as const, status: 503, error: 'web_push_503' }))))
    expect(await runRecovery(pool, 'dispatch', { send })).toMatchObject({ sent: 0, failed: 4, pending: 0 })
    await runRecovery(pool, 'dispatch', { send })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('keeps only uncertain devices leased while finalizing healthy siblings', async () => {
    await runRecovery(pool, 'enqueue')
    const send = vi.fn((items: readonly PushNotificationInput[]) => Promise.resolve(items.map(item =>
      item.subscription.endpoint.endsWith(devices[0]!)
        ? { id: item.id, ok: false as const, status: 0, error: 'delivery_outcome_unknown' }
        : { id: item.id, ok: true as const })))
    expect(await runRecovery(pool, 'dispatch', { send })).toMatchObject({ sent: 3, uncertain: 1, pending: 0 })
    await runRecovery(pool, 'dispatch', { send })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
