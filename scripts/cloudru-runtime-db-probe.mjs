import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const safeCode = error => typeof error?.code === 'string'
  && /^(?:[0-9][0-9A-Z]{4}|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|EPIPE|ETIMEDOUT)$/.test(error.code)
  ? error.code : 'unknown'

// Same runtime role and transaction-local limit as the worker. No application
// functions, table reads, writes, notifications or credential output.
export async function probeRuntimeDatabase(client) {
  let phase = 'connect', started = false
  try {
    await client.connect()
    phase = 'begin'
    await client.query('begin read only')
    started = true
    phase = 'timeout'
    await client.query("set local statement_timeout = '10s'")
    phase = 'role'
    const result = await client.query(`select current_user = 'fit_api' and not rolsuper and not rolbypassrls
      and current_setting('transaction_read_only') = 'on' as valid from pg_roles where rolname = current_user`)
    if (result.rows.length !== 1 || result.rows[0].valid !== true) throw new Error('runtime_role_rejected')
    phase = 'query'
    await client.query('select 1')
    phase = 'rollback'
    await client.query('rollback')
    started = false
    return { event: 'cloudru_runtime_database_probe', ready: true }
  } catch (error) {
    const report = { event: 'cloudru_runtime_database_probe', ready: false, phase, code: safeCode(error) }
    if (started) {
      try { await client.query('rollback') } catch (rollbackError) { report.rollbackCode = safeCode(rollbackError) }
    }
    return report
  } finally { await client.end() }
}

async function main() {
  const env = process.env
  if (env.DATABASE_HOST !== '10.70.10.67' || env.DATABASE_PORT !== '5432'
    || env.DATABASE_NAME !== 'fit' || env.DATABASE_USER !== 'fit_api'
    || env.DATABASE_SSL_MODE !== 'require' || env.DATABASE_URL !== undefined || !env.DATABASE_PASSWORD) {
    throw new Error('runtime_probe_target_rejected')
  }
  const { Client } = createRequire('/app/package.json')('pg')
  const report = await probeRuntimeDatabase(new Client({ host: env.DATABASE_HOST, port: 5432,
    database: env.DATABASE_NAME, user: env.DATABASE_USER, password: env.DATABASE_PASSWORD,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000, query_timeout: 5000 }))
  console.log(JSON.stringify(report))
  if (!report.ready) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('cloudru_runtime_database_probe_failed'); process.exitCode = 1 })
}
