import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { activateCloudruFreshPush, archiveCloudruPushHistory, archiveCloudruPushSnapshot, previewCloudruPushHistory, safeCutoverFailure } from './cloudru-background-cutover.js'
import type { DatabaseClient } from './db/types.js'
import { inspectCloudruQueue } from './cloudru-operations-health.js'

describe('Cloud.ru fresh push cutover', () => {
  it('reports fixed safety guards and SQLSTATE without database messages or unknown codes', () => {
    expect(safeCutoverFailure(new Error('cloudru_push_snapshot_changed'))).toEqual({ reason: 'cloudru_push_snapshot_changed' })
    const privateMessage = 'private-subscription-endpoint-and-password'
    expect(safeCutoverFailure({ message: privateMessage, code: '22023' })).toEqual({ reason: 'database_failure', code: '22023' })
    const unknown = safeCutoverFailure({ message: privateMessage, code: privateMessage })
    expect(unknown).toEqual({ reason: 'unknown' })
    expect(JSON.stringify(unknown)).not.toContain(privateMessage)
  })
  it('rejects an invalid snapshot capability before opening a transaction', async () => {
    const query = vi.fn()
    await expect(archiveCloudruPushSnapshot({ query }, new Date(), 'not-a-snapshot')).rejects.toThrow('cloudru_push_snapshot_rejected')
    expect(query).not.toHaveBeenCalled()
  })
  it('previews a bounded exact candidate snapshot without writes, personal data or delivery', async () => {
    const query = vi.fn<Parameters<typeof previewCloudruPushHistory>[0]['query']>().mockResolvedValue([])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ pending: 2, leased: 1, chat: 1, scheduled: 0, reminders: 0, tests: 1, other: 0, fingerprint: 'a'.repeat(64) }])
    const cutoff = new Date('2026-11-05T09:00:00Z')
    expect(await previewCloudruPushHistory({ query }, cutoff)).toEqual({ cutoff: cutoff.toISOString(), pending: 2, leased: 1,
      byKind: { chat: 1, scheduled: 0, reminders: 0, tests: 1, other: 0 }, fingerprint: 'a'.repeat(64) })
    expect(query.mock.calls[0]?.[0]).toBe('begin read only')
    expect(query.mock.calls[3]?.[1]).toEqual([cutoff.toISOString()])
    expect(query.mock.calls.map(call => call[0]).join('\n')).not.toMatch(/\b(?:update|delete|insert|commit|claim_push_notifications)\b/i)
    expect(query).toHaveBeenLastCalledWith('rollback')
  })

  it.each([501, -1])('rejects an unsupported preview size %s and rolls back', async pending => {
    const query = vi.fn<Parameters<typeof previewCloudruPushHistory>[0]['query']>().mockResolvedValue([])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ pending, leased: 0, chat: pending, scheduled: 0, reminders: 0, tests: 0, other: 0, fingerprint: 'a'.repeat(64) }])
    await expect(previewCloudruPushHistory({ query }, new Date())).rejects.toThrow('cloudru_push_preview_rejected')
    expect(query).toHaveBeenLastCalledWith('rollback')
  })
  it('archives only unsent historical events and the recovery campaign while retaining receipts and subscriptions', async () => {
    const query = vi.fn<Parameters<typeof archiveCloudruPushHistory>[0]['query']>().mockResolvedValue([])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{ archived: 3 }])
    const client = { query }
    const cutoff = new Date('2026-10-14T20:00:00Z')
    expect(await archiveCloudruPushHistory(client, cutoff)).toBe(3)
    const sql: string = String(query.mock.calls[4]?.[0])
    expect(sql).toContain('sent_at is null and discarded_at is null')
    expect(sql).toContain("created_at < $1 or kind = 'service_recovered_2026_10_14'")
    expect(sql).not.toMatch(/delete |dispatch_token\s*=|dispatch_started_at\s*=|attempts\s*=/i)
    expect(query.mock.calls[4]?.[1]).toEqual([cutoff.toISOString()])
    expect(query).toHaveBeenLastCalledWith('commit')
  })

  it('rolls back if the update or aggregate verification fails', async () => {
    const query = vi.fn<Parameters<typeof archiveCloudruPushHistory>[0]['query']>().mockResolvedValue([])
    const client = { query }
    await expect(archiveCloudruPushHistory(client, new Date())).rejects.toThrow('cloudru_push_archive_rejected')
    expect(query).toHaveBeenLastCalledWith('rollback')
  })
})

describe.skipIf(!process.env.TEST_CLOUDRU_OPERATIONS_DATABASE_URL && !process.env.TEST_DATABASE_URL)('push cutover on isolated PostgreSQL', () => {
  let pool: Pool
  let admin: Pool | undefined
  let created = false
  const database = `fit_cloudru_operations_${process.pid}`
  beforeAll(async () => {
    const explicit = process.env.TEST_CLOUDRU_OPERATIONS_DATABASE_URL
    const url = new URL(explicit ?? process.env.TEST_DATABASE_URL ?? '')
    if (!['localhost', '127.0.0.1'].includes(url.hostname)
      || url.pathname !== (explicit ? '/fit_cloudru_operations' : '/fit_actor_test')) {
      throw new Error('isolated_local_operations_database_required')
    }
    if (!explicit) {
      admin = new Pool({ connectionString: url.href, max: 1 })
      await admin.query(`create database ${database}`)
      created = true
      url.pathname = `/${database}`
    }
    pool = new Pool({ connectionString: url.href, max: 1 })
    await pool.query(`create schema app_private;
      create table app_private.push_notifications_outbox(
        id integer primary key, created_at timestamptz not null, kind text not null,
        sent_at timestamptz, discarded_at timestamptz, last_error text,
        dispatch_token text, dispatch_started_at timestamptz, attempts integer default 0);
      create table app_private.push_delivery_control(singleton boolean primary key,
        delivery_enabled boolean not null default false,fresh_after timestamptz,activated_at timestamptz,
        history_fingerprint text,history_cutoff timestamptz)`)
  })
  afterAll(async () => {
    await pool?.end()
    if (created) await admin?.query(`drop database ${database}`)
    await admin?.end()
  })
  beforeEach(async () => { await pool.query(`truncate app_private.push_notifications_outbox;
    delete from app_private.push_delivery_control;
    insert into app_private.push_delivery_control(singleton) values(true)`) })

  const wrap = (connection: PoolClient): DatabaseClient => ({
    query: async <Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) =>
      (await connection.query<Row>(text, [...values])).rows,
  })

  it('activates only the exact preserved snapshot, keeps new events and safely replays activation', async () => {
    const cutoff = new Date('2026-11-05T09:00:00Z')
    await pool.query(`insert into app_private.push_notifications_outbox(id,created_at,kind) values
      (1,'2026-11-04T09:00:00Z','test'),(2,'2026-11-05T09:01:00Z','chat_message')`)
    const connection = await pool.connect(), client = wrap(connection)
    try {
      const snapshot = await previewCloudruPushHistory(client, cutoff)
      await expect(activateCloudruFreshPush(client, cutoff, snapshot.fingerprint, cutoff)).rejects.toThrow('cloudru_push_activation_changed')
      await archiveCloudruPushSnapshot(client, cutoff, snapshot.fingerprint)
      await expect(activateCloudruFreshPush(client, cutoff, 'b'.repeat(64), cutoff)).rejects.toThrow('cloudru_push_activation_changed')
      const now = new Date(cutoff.getTime() + 60_000)
      expect(await activateCloudruFreshPush(client, cutoff, snapshot.fingerprint, now)).toEqual({ activated: true, alreadyActive: false, cutoff: cutoff.toISOString(), preserved: 1 })
      const state = (await connection.query('select * from app_private.push_delivery_control')).rows
      expect(state[0]).toMatchObject({ delivery_enabled: true, fresh_after: cutoff, activated_at: now })
      expect(await activateCloudruFreshPush(client, cutoff, snapshot.fingerprint, now)).toMatchObject({ activated: false, alreadyActive: true })
      expect((await connection.query('select * from app_private.push_delivery_control')).rows).toEqual(state)
      expect((await connection.query('select sent_at,discarded_at from app_private.push_notifications_outbox where id=2')).rows[0]).toEqual({ sent_at: null, discarded_at: null })
      await expect(archiveCloudruPushSnapshot(client, cutoff, snapshot.fingerprint)).rejects.toThrow('cloudru_push_delivery_not_held')
    } finally { connection.release() }
  })

  it.each(['new_history', 'lease', 'stale_boundary'] as const)('refuses activation with %s and retains the delivery hold', async change => {
    const cutoff = new Date('2026-11-05T09:00:00Z')
    await pool.query("insert into app_private.push_notifications_outbox(id,created_at,kind) values(1,'2026-11-04T09:00:00Z','test')")
    const connection = await pool.connect(), client = wrap(connection)
    try {
      const snapshot = await previewCloudruPushHistory(client, cutoff)
      await archiveCloudruPushSnapshot(client, cutoff, snapshot.fingerprint)
      if (change === 'new_history') await connection.query("insert into app_private.push_notifications_outbox(id,created_at,kind) values(2,'2026-11-04T09:00:00Z','test')")
      if (change === 'lease') await connection.query("insert into app_private.push_notifications_outbox(id,created_at,kind,dispatch_token) values(2,'2026-11-05T09:01:00Z','test','uncertain')")
      await expect(activateCloudruFreshPush(client, cutoff, snapshot.fingerprint,
        new Date(cutoff.getTime() + (change === 'stale_boundary' ? 300_001 : 60_000)))).rejects.toThrow(
          change === 'new_history' ? 'cloudru_push_history_not_preserved' : change === 'lease' ? 'cloudru_push_receipt_rejected' : 'cloudru_push_boundary_stale')
      expect((await connection.query('select delivery_enabled from app_private.push_delivery_control')).rows[0]).toEqual({ delivery_enabled: false })
    } finally { connection.release() }
  })

  it('recovers an activation commit with a lost reply without moving the boundary or resending', async () => {
    const cutoff = new Date('2026-11-05T09:00:00Z')
    const connection = await pool.connect(), client = wrap(connection)
    let loseReply = true
    const interrupted: DatabaseClient = { query: async <Row extends QueryResultRow>(text: string, values?: readonly unknown[]) => {
      const rows = await client.query<Row>(text, values)
      if (text === 'commit' && loseReply) { loseReply = false; throw new Error('synthetic_activation_reply_lost') }
      return rows
    } }
    try {
      const snapshot = await previewCloudruPushHistory(client, cutoff)
      await archiveCloudruPushSnapshot(client, cutoff, snapshot.fingerprint)
      await expect(activateCloudruFreshPush(interrupted, cutoff, snapshot.fingerprint, cutoff)).rejects.toThrow('synthetic_activation_reply_lost')
      const committed = (await connection.query('select * from app_private.push_delivery_control')).rows
      expect(await activateCloudruFreshPush(client, cutoff, snapshot.fingerprint, cutoff)).toMatchObject({ alreadyActive: true })
      expect((await connection.query('select * from app_private.push_delivery_control')).rows).toEqual(committed)
      expect((await connection.query('select count(*)::integer as count from app_private.push_notifications_outbox')).rows[0]).toEqual({ count: 0 })
    } finally { connection.release() }
  })

  it('archives only the inspected history once and preserves payload, sent records and new events', async () => {
    const cutoff = new Date('2026-11-05T09:00:00Z')
    await pool.query(`insert into app_private.push_notifications_outbox(id,created_at,kind,sent_at) values
      (1,'2026-11-04T09:00:00Z','test',null),
      (2,'2026-11-04T09:00:00Z','chat_message','2026-11-04T09:01:00Z'),
      (3,'2026-11-05T09:01:00Z','chat_message',null)`)
    const connection = await pool.connect(), client = wrap(connection)
    try {
      const original = (await connection.query<Record<string, unknown>>('select * from app_private.push_notifications_outbox order by id')).rows
      const snapshot = await previewCloudruPushHistory(client, cutoff)
      expect(await archiveCloudruPushSnapshot(client, cutoff, snapshot.fingerprint)).toMatchObject({ archived: 1, replayed: false })
      const first = (await connection.query<Record<string, unknown>>('select * from app_private.push_notifications_outbox order by id')).rows
      expect(first[0]?.discarded_at).toBeInstanceOf(Date)
      expect(first[0]?.last_error).toBe(`cloudru_recovery_history_preserved:${snapshot.fingerprint}`)
      expect({ ...first[0], discarded_at: null, last_error: null }).toEqual(original[0])
      expect(first.slice(1)).toEqual(original.slice(1))
      expect(await archiveCloudruPushSnapshot(client, cutoff, snapshot.fingerprint)).toMatchObject({ archived: 0, previouslyArchived: 1, replayed: true })
      expect((await connection.query('select * from app_private.push_notifications_outbox order by id')).rows).toEqual(first)
    } finally { connection.release() }
  })

  it.each(['content', 'new_candidate', 'lease'] as const)('rejects %s drift or uncertain delivery without modifying any record', async change => {
    const cutoff = new Date('2026-11-05T09:00:00Z')
    await pool.query("insert into app_private.push_notifications_outbox(id,created_at,kind) values(1,'2026-11-04T09:00:00Z','test')")
    const connection = await pool.connect(), client = wrap(connection)
    try {
      let snapshot = await previewCloudruPushHistory(client, cutoff)
      if (change === 'content') await connection.query("update app_private.push_notifications_outbox set last_error='changed-after-preview' where id=1")
      if (change === 'new_candidate') await connection.query("insert into app_private.push_notifications_outbox(id,created_at,kind) values(2,'2026-11-04T09:00:00Z','chat_message')")
      if (change === 'lease') {
        await connection.query("update app_private.push_notifications_outbox set dispatch_token='uncertain-receipt',dispatch_started_at=now() where id=1")
        snapshot = await previewCloudruPushHistory(client, cutoff)
      }
      const before = (await connection.query('select * from app_private.push_notifications_outbox order by id')).rows
      await expect(archiveCloudruPushSnapshot(client, cutoff, snapshot.fingerprint)).rejects.toThrow(change === 'lease' ? 'cloudru_push_snapshot_leased' : 'cloudru_push_snapshot_changed')
      expect((await connection.query('select * from app_private.push_notifications_outbox order by id')).rows).toEqual(before)
    } finally { connection.release() }
  })

  it('recovers a lost commit reply through the exact receipt without reapplying the update', async () => {
    const cutoff = new Date('2026-11-05T09:00:00Z')
    await pool.query("insert into app_private.push_notifications_outbox(id,created_at,kind) values(1,'2026-11-04T09:00:00Z','test')")
    const connection = await pool.connect(), client = wrap(connection)
    let loseReply = true
    const interrupted: DatabaseClient = { query: async <Row extends QueryResultRow>(text: string, values?: readonly unknown[]) => {
      const rows = await client.query<Row>(text, values)
      if (text === 'commit' && loseReply) { loseReply = false; throw new Error('synthetic_commit_reply_lost') }
      return rows
    } }
    try {
      const snapshot = await previewCloudruPushHistory(client, cutoff)
      await expect(archiveCloudruPushSnapshot(interrupted, cutoff, snapshot.fingerprint)).rejects.toThrow('synthetic_commit_reply_lost')
      const committed = (await connection.query('select * from app_private.push_notifications_outbox')).rows
      expect(await archiveCloudruPushSnapshot(client, cutoff, snapshot.fingerprint)).toMatchObject({ archived: 0, previouslyArchived: 1, replayed: true })
      expect((await connection.query('select * from app_private.push_notifications_outbox')).rows).toEqual(committed)
    } finally { connection.release() }
  })

  it('rejects more than500 real candidates rather than fingerprinting an incomplete batch', async () => {
    await pool.query("insert into app_private.push_notifications_outbox(id,created_at,kind) select value,'2026-11-04T09:00:00Z','test' from generate_series(1,501) value")
    const connection = await pool.connect()
    try {
      await expect(previewCloudruPushHistory(wrap(connection), new Date('2026-11-05T09:00:00Z'))).rejects.toThrow('cloudru_push_preview_rejected')
      expect((await connection.query<{ count: number }>('select count(*)::integer as count from app_private.push_notifications_outbox where discarded_at is null')).rows[0]?.count).toBe(501)
    } finally { connection.release() }
  })

  it('fingerprints candidate content and leases without mutating history or considering confirmed sends', async () => {
    const cutoff = new Date('2026-11-05T09:00:00Z')
    await pool.query(`insert into app_private.push_notifications_outbox(id,created_at,kind,sent_at) values
      (1,'2026-11-04T09:00:00Z','test',null),
      (2,'2026-11-04T09:00:00Z','chat_message','2026-11-04T09:01:00Z'),
      (3,'2026-11-05T09:01:00Z','chat_message',null)`)
    const connection = await pool.connect()
    const client: DatabaseClient = { query: async <Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) =>
      (await connection.query<Row>(text, [...values])).rows }
    try {
      const original = (await connection.query('select * from app_private.push_notifications_outbox order by id')).rows
      const first = await previewCloudruPushHistory(client, cutoff)
      expect(first).toMatchObject({ pending: 1, leased: 0, byKind: { tests: 1, chat: 0 } })
      expect(await previewCloudruPushHistory(client, cutoff)).toEqual(first)
      expect((await connection.query('select * from app_private.push_notifications_outbox order by id')).rows).toEqual(original)
      await connection.query("update app_private.push_notifications_outbox set last_error='synthetic-change' where id=1")
      expect((await previewCloudruPushHistory(client, cutoff)).fingerprint).not.toBe(first.fingerprint)
      await connection.query("update app_private.push_notifications_outbox set dispatch_token='synthetic-lease', dispatch_started_at=now() where id=1")
      expect(await previewCloudruPushHistory(client, cutoff)).toMatchObject({ leased: 1 })
    } finally { connection.release() }
  })

  it('retains confirmed sends and uncertain receipts, archives old pending events, and leaves new events deliverable across retries', async () => {
    const cutoff = new Date('2026-10-14T20:00:00Z')
    await pool.query(`insert into app_private.push_notifications_outbox
      (id,created_at,kind,sent_at,dispatch_token,dispatch_started_at) values
      (1,'2026-10-14T19:00:00Z','chat_message',null,null,null),
      (2,'2026-10-14T19:00:00Z','service_recovered_2026_10_14',null,'synthetic-receipt','2026-10-14T19:30:00Z'),
      (3,'2026-10-14T19:00:00Z','chat_message','2026-10-14T19:01:00Z',null,null),
      (4,'2026-10-14T20:01:00Z','chat_message',null,null,null)`)
    const connection = await pool.connect()
    try {
      const client: DatabaseClient = { query: async <Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) =>
        (await connection.query<Row>(text, [...values])).rows }
      expect(await archiveCloudruPushHistory(client, cutoff)).toBe(2)
      expect(await archiveCloudruPushHistory(client, cutoff)).toBe(0)
    } finally { connection.release() }
    const rows = await pool.query<{ id: number; discarded: boolean; sent: boolean; dispatch_token: string | null }>(
      'select id, discarded_at is not null as discarded, sent_at is not null as sent, dispatch_token from app_private.push_notifications_outbox order by id')
    expect(rows.rows).toEqual([
      { id: 1, discarded: true, sent: false, dispatch_token: null },
      { id: 2, discarded: true, sent: false, dispatch_token: 'synthetic-receipt' },
      { id: 3, discarded: false, sent: true, dispatch_token: null },
      { id: 4, discarded: false, sent: false, dispatch_token: null },
    ])
  })

  it('detects overdue queues and expired leases while excluding preserved historical receipts from new failures', async () => {
    await pool.query(`insert into app_private.push_notifications_outbox
      (id,created_at,kind,dispatch_started_at,discarded_at,attempts,last_error) values
      (1,now()-interval '1 minute','chat_message',null,null,0,null),
      (2,now()-interval '20 minutes','chat_message',null,null,0,null),
      (3,now()-interval '20 minutes','chat_message',now()-interval '11 minutes',null,0,null),
      (4,now()-interval '1 day','chat_message',null,now(),10,'cloudru_cutover_history_preserved'),
      (5,now()-interval '20 minutes','chat_message',null,now(),10,'web_push_500'),
      (6,now()-interval '1 day','test',null,now(),10,'cloudru_recovery_history_preserved:'||repeat('a',64)),
      (7,now()-interval '1 day','test',null,now(),10,'cloudru_recovery_history_preserved:malformed')`)
    const connection = await pool.connect()
    try {
      await expect(inspectCloudruQueue({ query: async text => (await connection.query<Record<string, unknown>>(text)).rows }))
        .resolves.toEqual({ pending: 3, overdue: 2, staleLeases: 1, terminalFailures: 2, deliveryHeld: true, quarantined: 3, freshOverdue: 0 })
    } finally { connection.release() }
  })
})
