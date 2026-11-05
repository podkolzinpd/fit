import { pathToFileURL } from 'node:url'
import { Client, type QueryResultRow } from 'pg'
import type { DatabaseClient } from './db/types.js'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'

type HistoryClient = {
  query(text: string, values?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>
}

async function lockDelivery(client: HistoryClient) {
  const rows = await client.query(`select delivery_enabled, fresh_after, history_fingerprint, history_cutoff
    from app_private.push_delivery_control where singleton for update`)
  const row = rows[0]
  if (!row || typeof row.delivery_enabled !== 'boolean') throw new Error('cloudru_push_control_rejected')
  return row
}

async function readHistorySnapshot(client: HistoryClient, cutoff: Date) {
    const rows = await client.query(`with candidates as materialized (
      select notification.* from app_private.push_notifications_outbox notification
      where sent_at is null and discarded_at is null
        and (created_at < $1 or kind = 'service_recovered_2026_10_14')
      order by id limit 501
    ) select count(*)::integer as pending,
      count(*) filter (where dispatch_started_at is not null or dispatch_token is not null)::integer as leased,
      count(*) filter (where kind = 'chat_message')::integer as chat,
      count(*) filter (where kind = 'workout_scheduled')::integer as scheduled,
      count(*) filter (where kind = 'workout_reminder')::integer as reminders,
      count(*) filter (where kind = 'test')::integer as tests,
      count(*) filter (where kind not in ('chat_message','workout_scheduled','workout_reminder','test'))::integer as other,
      encode(sha256(convert_to(coalesce(string_agg(
        encode(sha256(convert_to(to_jsonb(candidates)::text,'UTF8')),'hex'),'' order by id
      ),''),'UTF8')),'hex') as fingerprint from candidates`, [cutoff.toISOString()])
    const row = rows[0]
    if (!row) throw new Error('cloudru_push_preview_rejected')
    const count = (name: string): number => {
      const value = row[name]
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('cloudru_push_preview_rejected')
      return value
    }
    const pending = count('pending'), leased = count('leased')
    const byKind = { chat: count('chat'), scheduled: count('scheduled'), reminders: count('reminders'), tests: count('tests'), other: count('other') }
    if (pending > 500 || leased > pending || Object.values(byKind).reduce((sum, value) => sum + value, 0) !== pending
      || typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint)) throw new Error('cloudru_push_preview_rejected')
    return { cutoff: cutoff.toISOString(), pending, leased, byKind, fingerprint: row.fingerprint }
}

export async function previewCloudruPushHistory(client: HistoryClient, cutoff: Date) {
  if (!Number.isFinite(cutoff.getTime())) throw new Error('cloudru_push_cutoff_rejected')
  await client.query('begin read only')
  try {
    await client.query("set local statement_timeout = '5s'")
    // Keep fingerprints identical across owner connections with different defaults.
    await client.query("set local timezone = 'UTC'")
    const snapshot = await readHistorySnapshot(client, cutoff)
    await client.query('rollback')
    return snapshot
  } catch (error) { await client.query('rollback'); throw error }
}

// Not an automatic recovery hook. The recovery operator must hold delivery
// before applying this exact, previously inspected snapshot.
export async function archiveCloudruPushSnapshot(client: HistoryClient, cutoff: Date, fingerprint: string) {
  if (!Number.isFinite(cutoff.getTime()) || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('cloudru_push_snapshot_rejected')
  const reason = `cloudru_recovery_history_preserved:${fingerprint}`
  await client.query('begin')
  try {
    await client.query("set local statement_timeout = '20s'")
    await client.query("set local lock_timeout = '3s'")
    await client.query("set local timezone = 'UTC'")
    await client.query("select pg_advisory_xact_lock(hashtextextended('fit-cloudru-push-cutover', 0))")
    const control = await lockDelivery(client)
    if (control.delivery_enabled !== false) throw new Error('cloudru_push_delivery_not_held')
    // Serialize the snapshot check with enqueue, claim and finalization writes.
    await client.query('lock table app_private.push_notifications_outbox in share row exclusive mode')
    const snapshot = await readHistorySnapshot(client, cutoff)
    if (snapshot.pending === 0 && snapshot.fingerprint !== fingerprint) {
      if (control.history_fingerprint !== fingerprint || !(control.history_cutoff instanceof Date)
        || control.history_cutoff.getTime() !== cutoff.getTime()) throw new Error('cloudru_push_snapshot_changed')
      const receipts = await client.query(`select count(*)::integer as count
        from app_private.push_notifications_outbox
        where sent_at is null and discarded_at is not null and last_error = $2
          and (created_at < $1 or kind = 'service_recovered_2026_10_14')`, [cutoff.toISOString(), reason])
      const previous = receipts[0]?.count
      if (typeof previous !== 'number' || !Number.isSafeInteger(previous) || previous < 1 || previous > 500) {
        throw new Error('cloudru_push_snapshot_changed')
      }
      await client.query('commit')
      return { archived: 0, previouslyArchived: previous, replayed: true, fingerprint }
    }
    if (snapshot.fingerprint !== fingerprint) throw new Error('cloudru_push_snapshot_changed')
    if (snapshot.leased !== 0) throw new Error('cloudru_push_snapshot_leased')
    const rows = await client.query(`with archived as (
      update app_private.push_notifications_outbox
      set discarded_at = now(), last_error = $2
      where sent_at is null and discarded_at is null
        and (created_at < $1 or kind = 'service_recovered_2026_10_14')
      returning 1
    ) select count(*)::integer as archived from archived`, [cutoff.toISOString(), reason])
    if (rows[0]?.archived !== snapshot.pending) throw new Error('cloudru_push_snapshot_changed')
    await client.query(`update app_private.push_delivery_control
      set history_fingerprint=$1,history_cutoff=$2 where singleton`, [fingerprint, cutoff.toISOString()])
    await client.query('commit')
    return { archived: snapshot.pending, previouslyArchived: 0, replayed: false, fingerprint }
  } catch (error) { await client.query('rollback'); throw error }
}

// Open only the fresh boundary whose old pending snapshot has already been
// preserved. A held interval never becomes an automatic replay window.
export async function activateCloudruFreshPush(client: HistoryClient, cutoff: Date, fingerprint: string, now = new Date()) {
  if (!Number.isFinite(cutoff.getTime()) || !Number.isFinite(now.getTime())
    || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('cloudru_push_activation_rejected')
  await client.query('begin')
  try {
    await client.query("set local statement_timeout = '20s'")
    await client.query("set local lock_timeout = '3s'")
    await client.query("set local timezone = 'UTC'")
    await client.query("select pg_advisory_xact_lock(hashtextextended('fit-cloudru-push-cutover', 0))")
    const control = await lockDelivery(client)
    if (control.history_fingerprint !== fingerprint || !(control.history_cutoff instanceof Date)
      || control.history_cutoff.getTime() !== cutoff.getTime()) throw new Error('cloudru_push_activation_changed')
    if (control.delivery_enabled) {
      if (!(control.fresh_after instanceof Date) || control.fresh_after.getTime() !== cutoff.getTime()) throw new Error('cloudru_push_activation_changed')
      await client.query('commit')
      return { activated: false, alreadyActive: true, cutoff: cutoff.toISOString() }
    }
    if (cutoff.getTime() > now.getTime() || now.getTime() - cutoff.getTime() > 300_000) throw new Error('cloudru_push_boundary_stale')
    await client.query('lock table app_private.push_notifications_outbox in share row exclusive mode')
    const snapshot = await readHistorySnapshot(client, cutoff)
    if (snapshot.pending !== 0) throw new Error('cloudru_push_history_not_preserved')
    const rows = await client.query(`select
      count(*) filter (where sent_at is null and discarded_at is not null and last_error=$2
        and (created_at < $1 or kind='service_recovered_2026_10_14'))::integer as receipts,
      count(*) filter (where sent_at is null and discarded_at is null
        and (dispatch_token is not null or dispatch_started_at is not null))::integer as leased
      from app_private.push_notifications_outbox`, [cutoff.toISOString(), `cloudru_recovery_history_preserved:${fingerprint}`])
    const receipt = rows[0]
    if (!receipt || receipt.leased !== 0 || typeof receipt.receipts !== 'number'
      || !Number.isSafeInteger(receipt.receipts) || receipt.receipts < 0 || receipt.receipts > 500
      || (receipt.receipts === 0 && fingerprint !== snapshot.fingerprint)) throw new Error('cloudru_push_receipt_rejected')
    await client.query(`update app_private.push_delivery_control
      set delivery_enabled=true,fresh_after=$1,activated_at=$2 where singleton`, [cutoff.toISOString(), now.toISOString()])
    await client.query('commit')
    return { activated: true, alreadyActive: false, cutoff: cutoff.toISOString(), preserved: receipt.receipts }
  } catch (error) { await client.query('rollback'); throw error }
}

export async function archiveCloudruPushHistory(client: {
  query(text: string, values?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>
}, cutoff: Date): Promise<number> {
  if (!Number.isFinite(cutoff.getTime())) throw new Error('cloudru_push_cutoff_rejected')
  await client.query('begin')
  try {
    await client.query("set local statement_timeout = '20s'")
    await client.query("set local lock_timeout = '3s'")
    await client.query("select pg_advisory_xact_lock(hashtextextended('fit-cloudru-push-cutover', 0))")
    const rows = await client.query(`with archived as (
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
      || process.env.MIGRATION_DATABASE_URL !== undefined || process.env.MIGRATION_DATABASE_SSL_MODE !== 'require'
      || process.env.CLOUDRU_PUSH_CONFIRMATION !== 'START_CLOUDRU_FRESH_PUSH_ONLY') throw new Error('rejected')
    const cutoff = new Date(process.env.CLOUDRU_PUSH_CUTOFF ?? '')
    const mode = process.env.CLOUDRU_PUSH_MODE ?? 'archive'
    if (!['preview', 'archive', 'archive_verified', 'activate'].includes(mode) || !Number.isFinite(cutoff.getTime())
      || cutoff.getTime() > Date.now()
      || (['archive', 'archive_verified'].includes(mode) && Date.now() - cutoff.getTime() > 300_000)) throw new Error('rejected')
    const fingerprint = process.env.CLOUDRU_PUSH_FINGERPRINT ?? ''
    if (['archive_verified', 'activate'].includes(mode) && !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('rejected')
    const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
    if (!config) throw new Error('rejected')
    const client = new Client({ ...config, connectionTimeoutMillis: 5000 })
    await client.connect()
    try {
      const identity = await client.query<{ valid: boolean }>("select current_user='fit_owner' and current_database()='fit' as valid")
      if (identity.rows[0]?.valid !== true) throw new Error('cloudru_push_target_rejected')
      const wrapper: DatabaseClient = { query: async <Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) => (await client.query<Row>(text, [...values])).rows }
      const result = mode === 'preview'
        ? { event: 'cloudru_push_history_preview', ...await previewCloudruPushHistory(wrapper, cutoff) }
        : mode === 'archive_verified'
          ? { event: 'cloudru_push_history_preserved', ...await archiveCloudruPushSnapshot(wrapper, cutoff, fingerprint) }
          : mode === 'activate'
            ? { event: 'cloudru_push_fresh_delivery_activated', ...await activateCloudruFreshPush(wrapper, cutoff, fingerprint) }
            : { event: 'cloudru_push_history_preserved', archived: await archiveCloudruPushHistory(wrapper, cutoff) }
      console.log(JSON.stringify(result))
    } finally { await client.end() }
  }
  main().catch(() => { console.error('cloudru_push_cutover_failed'); process.exitCode = 1 })
}
