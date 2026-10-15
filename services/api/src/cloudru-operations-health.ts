import { Client, type QueryResultRow } from 'pg'
import { pathToFileURL } from 'node:url'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import type { DatabaseClient } from './db/types.js'

export async function inspectCloudruQueue(client: { query(text: string): Promise<readonly Record<string, unknown>[]> }) {
  await client.query('begin read only')
  try {
    await client.query("set local statement_timeout = '5s'")
    const rows = await client.query(`
      select count(*) filter (where sent_at is null and discarded_at is null)::integer as pending,
        count(*) filter (where sent_at is null and discarded_at is null
          and created_at < now() - interval '15 minutes')::integer as overdue,
        count(*) filter (where sent_at is null and discarded_at is null
          and dispatch_started_at < now() - interval '10 minutes')::integer as "staleLeases",
        count(*) filter (where discarded_at > now() - interval '1 hour' and attempts >= 10
          and last_error is distinct from 'cloudru_cutover_history_preserved')::integer as "terminalFailures"
      from app_private.push_notifications_outbox`)
    const result = rows[0]
    if (!result) throw new Error('cloudru_queue_report_rejected')
    const count = (value: unknown): number => {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('cloudru_queue_report_rejected')
      return value
    }
    const report = { pending: count(result.pending), overdue: count(result.overdue),
      staleLeases: count(result.staleLeases), terminalFailures: count(result.terminalFailures) }
    await client.query('commit')
    return report
  } catch (error) { await client.query('rollback'); throw error }
}

async function main() {
  if (process.env.MIGRATION_DATABASE_HOST !== '10.70.10.67' || process.env.MIGRATION_DATABASE_PORT !== '5432'
    || process.env.MIGRATION_DATABASE_NAME !== 'fit' || process.env.MIGRATION_DATABASE_USER !== 'fit_owner'
    || process.env.MIGRATION_DATABASE_SSL_MODE !== 'require' || process.env.MIGRATION_DATABASE_URL !== undefined) {
    throw new Error('cloudru_queue_target_rejected')
  }
  const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
  if (!config) throw new Error('cloudru_queue_config_missing')
  const client = new Client({ ...config, connectionTimeoutMillis: 5000 })
  await client.connect()
  try {
    const wrapper: DatabaseClient = { query: async <Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) =>
      (await client.query<Row>(text, [...values])).rows }
    const report = await inspectCloudruQueue(wrapper)
    console.log(JSON.stringify({ event: 'cloudru_queue_health', ...report }))
    if (report.overdue || report.staleLeases || report.terminalFailures) process.exitCode = 1
  } finally { await client.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('cloudru_queue_inspection_failed'); process.exitCode = 1 })
}
