import { pathToFileURL } from 'node:url'
import { Client, type QueryResultRow } from 'pg'
import type { DatabaseClient } from './db/types.js'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'

export async function archiveCloudruPushHistory(client: DatabaseClient, cutoff: Date): Promise<number> {
  if (!Number.isFinite(cutoff.getTime())) throw new Error('cloudru_push_cutoff_rejected')
  await client.query('begin')
  try {
    await client.query("set local statement_timeout = '20s'")
    await client.query("set local lock_timeout = '3s'")
    await client.query("select pg_advisory_xact_lock(hashtextextended('fit-cloudru-push-cutover', 0))")
    const rows = await client.query<{ archived: number }>(`with archived as (
      update app_private.push_notifications_outbox
      set discarded_at = now(), last_error = 'cloudru_cutover_history_preserved'
      where sent_at is null and discarded_at is null
        and (created_at < $1 or kind = 'service_recovered_2026_10_14')
      returning 1
    ) select count(*)::integer as archived from archived`, [cutoff.toISOString()])
    const count = rows[0]?.archived
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error('cloudru_push_archive_rejected')
    await client.query('commit')
    return count
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const main = async () => {
    if (process.env.MIGRATION_DATABASE_HOST !== '10.70.10.67' || process.env.MIGRATION_DATABASE_PORT !== '5432'
      || process.env.MIGRATION_DATABASE_NAME !== 'fit' || process.env.MIGRATION_DATABASE_USER !== 'fit_owner'
      || process.env.CLOUDRU_PUSH_CONFIRMATION !== 'START_CLOUDRU_FRESH_PUSH_ONLY') throw new Error('rejected')
    const cutoff = new Date(process.env.CLOUDRU_PUSH_CUTOFF ?? '')
    if (!Number.isFinite(cutoff.getTime()) || Math.abs(Date.now() - cutoff.getTime()) > 300_000) throw new Error('rejected')
    const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
    if (!config) throw new Error('rejected')
    const client = new Client({ ...config, connectionTimeoutMillis: 5000 })
    await client.connect()
    try {
      const wrapper: DatabaseClient = { query: async <Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) => (await client.query<Row>(text, [...values])).rows }
      console.log(JSON.stringify({ event: 'cloudru_push_history_preserved', archived: await archiveCloudruPushHistory(wrapper, cutoff) }))
    } finally { await client.end() }
  }
  main().catch(() => { console.error('cloudru_push_cutover_failed'); process.exitCode = 1 })
}
