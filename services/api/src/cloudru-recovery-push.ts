import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { PgDatabasePool } from './db/pg-pool.js'
import type { DatabaseConnection, DatabasePool } from './db/types.js'
import { finalizePushNotifications } from './push-dispatcher-command.js'
import { YandexPushNotificationSender, type PushNotificationSender } from './push-notifications/http-sender.js'
import { parsePushRequest } from './push-notifications/parse-request.js'

export const recoveryCampaign = {
  kind: 'service_recovered_2026_10_14',
  title: 'ФИТ снова работает 💪',
  body: 'Всё починили. Возвращайтесь к тренировкам!',
  data: JSON.stringify({ announcement: 'cloudru_recovery_2026_10_14', url: '/' }),
} as const

const eligible = `select subscription.id, subscription.user_id
  from public.push_subscriptions subscription
  where exists (
    select 1 from (values ('workout_reminder'), ('workout_scheduled'), ('chat_message')) category(kind)
    where coalesce((select preference.enabled from public.notification_preferences preference
      where preference.user_id = subscription.user_id and preference.kind = category.kind), true)
  )`

export async function recoveryStatus(connection: DatabaseConnection) {
  const rows = await connection.query(`with eligible as (${eligible})
    select (select count(*) from public.profiles)::int as "totalUsers",
      (select count(distinct user_id) from public.push_subscriptions)::int as "subscribedUsers",
      (select count(distinct user_id) from eligible)::int as "eligibleUsers",
      (select count(*) from eligible)::int as "eligibleSubscriptions",
      count(*)::int as queued,
      count(*) filter (where sent_at is not null)::int as sent,
      count(*) filter (where discarded_at is not null)::int as discarded,
      count(*) filter (where sent_at is null and discarded_at is null
        and dispatch_token is null and attempts = 0)::int as pending,
      count(*) filter (where sent_at is null and discarded_at is null
        and dispatch_token is not null)::int as uncertain,
      count(*) filter (where sent_at is null and discarded_at is null
        and dispatch_token is null and attempts > 0)::int as failed
    from app_private.push_notifications_outbox where kind = $1 and data = $2::jsonb`,
  [recoveryCampaign.kind, recoveryCampaign.data])
  const result = rows[0]
  if (!result || Object.values(result).some(value =>
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('recovery_aggregate_invalid')
  }
  return result
}

export async function enqueueRecovery(connection: DatabaseConnection) {
  await connection.query('begin')
  try {
    await connection.query("set local statement_timeout = '30s'")
    await connection.query("set local lock_timeout = '5s'")
    await connection.query('select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [recoveryCampaign.kind])
    const rows = await connection.query(`with inserted as (
      insert into app_private.push_notifications_outbox
        (kind, user_id, title, body, data, subscription_id)
      select $1, eligible.user_id, $2, $3, $4::jsonb, eligible.id
      from (${eligible}) eligible
      on conflict (kind, user_id, data, subscription_id) do nothing returning id
    ) select count(*)::int as inserted from inserted`,
    [recoveryCampaign.kind, recoveryCampaign.title, recoveryCampaign.body, recoveryCampaign.data])
    await connection.query('commit')
    return rows[0]?.inserted as number
  } catch (error) {
    await connection.query('rollback')
    throw error
  }
}

// Lease only this reviewed campaign. Historical outbox messages and failed or
// uncertain attempts are deliberately left for a separate diagnosis, never
// automatically resent after a transport timeout or lost finalization.
export async function dispatchRecovery(connection: DatabaseConnection, sender: PushNotificationSender) {
  let sent = 0
  let failed = 0
  for (let batch = 0; batch < 100; batch += 1) {
    const token = randomUUID()
    await connection.query('begin')
    let rows
    try {
      await connection.query("set local statement_timeout = '30s'")
      await connection.query(`update app_private.push_notifications_outbox n
        set discarded_at = now(), last_error = 'subscription_missing_or_disabled'
        where n.kind = $1 and n.data = $2::jsonb and n.sent_at is null
          and n.discarded_at is null and n.dispatch_token is null and n.attempts = 0
          and not exists (select 1 from (${eligible}) e
            where e.id = n.subscription_id and e.user_id = n.user_id)`,
      [recoveryCampaign.kind, recoveryCampaign.data])
      rows = await connection.query(`with due as materialized (
        select n.id, s.endpoint, s.p256dh, s.auth_key
        from app_private.push_notifications_outbox n
        join public.push_subscriptions s on s.id = n.subscription_id and s.user_id = n.user_id
        where n.kind = $1 and n.data = $2::jsonb and n.sent_at is null
          and n.discarded_at is null and n.dispatch_token is null and n.attempts = 0
        order by n.created_at, n.id limit 20 for update of n, s skip locked
      ), claimed as (
        update app_private.push_notifications_outbox n
        set dispatch_started_at = now(), dispatch_token = $3::uuid
        from due where n.id = due.id returning n.id, n.title, n.body, n.data
      ) select claimed.id, claimed.title, claimed.body, claimed.data,
        jsonb_build_object('endpoint', due.endpoint,
          'keys', jsonb_build_object('p256dh', due.p256dh, 'auth', due.auth_key)) as subscription
        from claimed join due using(id)`, [recoveryCampaign.kind, recoveryCampaign.data, token])
      // Validate before committing the lease; malformed migrated state cannot
      // reach the sender or expose subscription data through exception text.
      if (rows.length > 0) parsePushRequest({ notifications: rows })
      await connection.query('commit')
    } catch (error) {
      await connection.query('rollback')
      throw error
    }
    if (rows.length === 0) return { sent, failed }
    const results = await sender.send(parsePushRequest({ notifications: rows }))
    await connection.query('begin')
    try {
      const finalized = await finalizePushNotifications(connection, token, results, new Date())
      await connection.query('commit')
      sent += finalized.succeeded
      failed += finalized.failed
    } catch (error) {
      await connection.query('rollback')
      throw error
    }
  }
  throw new Error('recovery_batch_limit_reached')
}

export async function runRecovery(pool: DatabasePool, action: 'inspect' | 'enqueue' | 'dispatch',
  sender?: PushNotificationSender) {
  const connection = await pool.connect()
  try {
    const identity = await connection.query('select current_user as role')
    if (identity[0]?.role !== 'fit_owner') throw new Error('recovery_owner_required')
    let inserted = 0
    if (action === 'enqueue') inserted = await enqueueRecovery(connection)
    if (action === 'dispatch') {
      if (!sender) throw new Error('recovery_sender_required')
      await dispatchRecovery(connection, sender)
    }
    return { action, inserted, ...await recoveryStatus(connection) }
  } finally {
    connection.release()
  }
}

async function main() {
  const action = process.env.RECOVERY_ACTION
  if (action !== 'inspect' && action !== 'enqueue' && action !== 'dispatch') {
    throw new Error('recovery_action_invalid')
  }
  if (action !== 'inspect' && process.env.RECOVERY_CONFIRMATION !== 'SEND_FIT_RECOVERY_2026_10_14') {
    throw new Error('recovery_confirmation_required')
  }
  const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
  if (!config || config.host !== '10.70.10.67' || config.database !== 'fit'
    || config.user !== 'fit_owner' || config.port !== 5432) {
    throw new Error('recovery_cloudru_target_required')
  }
  const pool = new PgDatabasePool({ ...config, max: 1 }, 'migration-owner')
  try {
    const sender = action === 'dispatch' ? new YandexPushNotificationSender(
      process.env.PUSH_FUNCTION_URL ?? '', process.env.PUSH_DISPATCH_SECRET ?? '') : undefined
    console.log(JSON.stringify(await runRecovery(pool, action, sender)))
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main() } catch {
    // Never print a DB error, HTTP body or subscription identifiers.
    console.error('Recovery push operation failed; inspect aggregate state before any retry.')
    process.exitCode = 1
  }
}
