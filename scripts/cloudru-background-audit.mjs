import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const code = error => typeof error?.code === 'string' && /^[0-9][0-9A-Z]{4}$/.test(error.code) ? error.code : 'unknown'
const count = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('background_audit_count_rejected')
  return value
}

// The SELECT predicates mirror migration 000038, without INSERT or application
// function calls. Never return workout/profile/subscription contents to stdout.
export const reminderCandidates = `select count(*)::integer as count
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  join public.profiles profile on profile.id = client.auth_user_id
  join public.push_subscriptions subscription on subscription.user_id = client.auth_user_id
  where workout.status = 'planned' and workout.deleted_at is null
    and client.auth_user_id is not null
    and coalesce((select preference.enabled from public.notification_preferences preference
      where preference.user_id = client.auth_user_id and preference.kind = 'workout_reminder'), true)
    and (now() at time zone profile.timezone)::date = workout.workout_date
    and (now() at time zone profile.timezone)::time >= time '09:00'
    and (now() at time zone profile.timezone)::time < time '09:05'`

export async function auditBackground(client) {
  let started = false
  try {
    await client.query('begin read only')
    started = true
    await client.query("set local statement_timeout = '5s'")
    const role = await client.query(`select current_user = 'fit_owner'
      and current_setting('transaction_read_only') = 'on' as valid`)
    if (role.rows[0]?.valid !== true) throw new Error('background_audit_role_rejected')
    const queue = await client.query(`select
      case when kind in ('chat_message','workout_scheduled','workout_reminder','test') then kind else 'other' end as kind,
      case when created_at >= now() - interval '15 minutes' then 'under_15m'
        when created_at >= now() - interval '1 day' then 'under_1d' else 'older' end as age,
      count(*)::integer as count
      from app_private.push_notifications_outbox where sent_at is null and discarded_at is null
      group by 1,2 order by 1,2`)
    const groups = queue.rows.map(row => {
      if (!['chat_message','workout_scheduled','workout_reminder','test','other'].includes(row.kind)
        || !['under_15m','under_1d','older'].includes(row.age)) throw new Error('background_audit_group_rejected')
      return { kind: row.kind, age: row.age, count: count(row.count) }
    })
    await client.query('savepoint reminder_probe')
    let reminder
    try {
      const rows = await client.query(reminderCandidates)
      reminder = { ready: true, count: count(rows.rows[0]?.count) }
    } catch (error) {
      reminder = { ready: false, code: code(error) }
      await client.query('rollback to savepoint reminder_probe')
    }
    await client.query('release savepoint reminder_probe')
    // Validate PostgreSQL's actual conversion, not a guessed timezone-name list.
    // Values remain in process memory; the report contains only counts/codes.
    const zones = await client.query(`select distinct profile.timezone from public.profiles profile
      join public.clients client on client.auth_user_id = profile.id
      join public.workouts workout on workout.client_id = client.id
      where workout.status = 'planned' and workout.deleted_at is null limit 101`)
    if (zones.rows.length > 100) throw new Error('background_audit_zone_bound_exceeded')
    const invalid = new Map()
    for (const row of zones.rows) {
      await client.query('savepoint zone_probe')
      try { await client.query('select (now() at time zone $1::text)::date is not null as valid', [row.timezone]) }
      catch (error) {
        invalid.set(code(error), (invalid.get(code(error)) ?? 0) + 1)
        await client.query('rollback to savepoint zone_probe')
      }
      await client.query('release savepoint zone_probe')
    }
    await client.query('rollback')
    started = false
    return { event: 'cloudru_background_audit', groups, reminderCandidates: reminder,
      timezoneChecks: { checked: zones.rows.length, failures: [...invalid].map(([code, count]) => ({ code, count })) } }
  } finally { if (started) await client.query('rollback') }
}

async function main() {
  const env = process.env
  if (env.MIGRATION_DATABASE_HOST !== '10.70.10.67' || env.MIGRATION_DATABASE_PORT !== '5432'
    || env.MIGRATION_DATABASE_NAME !== 'fit' || env.MIGRATION_DATABASE_USER !== 'fit_owner'
    || env.MIGRATION_DATABASE_SSL_MODE !== 'require' || env.MIGRATION_DATABASE_URL !== undefined
    || !env.MIGRATION_DATABASE_PASSWORD) throw new Error('background_audit_target_rejected')
  const { Client } = createRequire('/app/package.json')('pg')
  const client = new Client({ host: env.MIGRATION_DATABASE_HOST, port: 5432, database: 'fit', user: 'fit_owner',
    password: env.MIGRATION_DATABASE_PASSWORD, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000, query_timeout: 5000 })
  await client.connect()
  try { console.log(JSON.stringify(await auditBackground(client))) } finally { await client.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('cloudru_background_audit_failed'); process.exitCode = 1 })
}
