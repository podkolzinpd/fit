import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool, type QueryResultRow } from 'pg'
import { archiveCloudruPushHistory } from './cloudru-background-cutover.js'
import type { DatabaseClient } from './db/types.js'
import { inspectCloudruQueue } from './cloudru-operations-health.js'

describe('Cloud.ru fresh push cutover', () => {
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

describe.skipIf(!process.env.TEST_CLOUDRU_OPERATIONS_DATABASE_URL)('push cutover on isolated PostgreSQL', () => {
  let pool: Pool
  beforeAll(async () => {
    const url = new URL(process.env.TEST_CLOUDRU_OPERATIONS_DATABASE_URL ?? '')
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/fit_cloudru_operations') {
      throw new Error('isolated_local_operations_database_required')
    }
    pool = new Pool({ connectionString: url.href, max: 1 })
    await pool.query(`create schema app_private;
      create table app_private.push_notifications_outbox(
        id integer primary key, created_at timestamptz not null, kind text not null,
        sent_at timestamptz, discarded_at timestamptz, last_error text,
        dispatch_token text, dispatch_started_at timestamptz, attempts integer default 0)`)
  })
  afterAll(async () => { await pool?.end() })
  beforeEach(async () => { await pool.query('truncate app_private.push_notifications_outbox') })

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
      (5,now()-interval '20 minutes','chat_message',null,now(),10,'web_push_500')`)
    const connection = await pool.connect()
    try {
      await expect(inspectCloudruQueue({ query: async text => (await connection.query<Record<string, unknown>>(text)).rows }))
        .resolves.toEqual({ pending: 3, overdue: 2, staleLeases: 1, terminalFailures: 1 })
    } finally { connection.release() }
  })
})
