import { Client } from 'pg'
import { buildDatabaseConnectionConfig } from '/app/dist/db/connection-config.js'
const config = buildDatabaseConnectionConfig('DATABASE')
const client = new Client({ ...config, connectionTimeoutMillis: 5000, query_timeout: 10000 })
try {
  const start = performance.now()
  await client.connect()
  await client.query('begin read only')
  await client.query("set local statement_timeout='5s'")
  const { rows } = await client.query(`select backend_type, state, wait_event_type, wait_event, count(*)::integer as connections, max(extract(epoch from clock_timestamp()-backend_start))::integer as oldest_seconds from pg_stat_activity group by backend_type,state,wait_event_type,wait_event order by count(*) desc`)
  const uptime = await client.query(`select extract(epoch from clock_timestamp()-pg_postmaster_start_time())::integer as uptime_seconds, current_setting('max_connections') as max_connections`)
  const limits = await client.query("select rolname,rolconnlimit from pg_roles where rolname in ('fit_api','fit_owner')")
  const db = await client.query("select numbackends,conflicts,deadlocks,sessions,sessions_abandoned,sessions_fatal,sessions_killed,stats_reset from pg_stat_database where datname=current_database()")
  console.log(JSON.stringify({event:'incident_database_counters',limits:limits.rows,database:db.rows}))
  await client.query('rollback')
  console.log(JSON.stringify({event:'incident_database_state',durationMs:Math.round(performance.now()-start),states:rows,server:uptime.rows[0]}))
} catch (error) {
  console.log(JSON.stringify({event:'incident_database_state',ready:false,code:/^[0-9A-Z_]{1,40}$/.test(error.code??'')?error.code:'unknown'}))
  process.exitCode = 1
} finally { await client.end() }
