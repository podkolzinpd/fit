import { Client, type QueryResultRow } from 'pg'
import { pathToFileURL } from 'node:url'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import type { DatabaseClient } from './db/types.js'
import { readNativeNutritionPilot } from './nutrition-pilot.js'

// Admission audit only: no account/consent/identity/binding mutations, no IDs.
export async function inspectNutritionBindings(client: {
  query(sql: string, values?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>
}, clients: readonly string[], trainers: readonly string[]) {
  if (![4, 5].includes(clients.length) || trainers.length !== 2
    || [...clients, ...trainers].some(x => !/^[a-f0-9]{64}$/.test(x))
    || new Set([...clients, ...trainers]).size !== clients.length + trainers.length) throw new Error('nutrition_binding_cohort_rejected')
  await client.query('begin read only')
  try {
    await client.query("set local statement_timeout = '5s'")
    await client.query("set local lock_timeout = '2s'")
    const settings = await client.query(`select current_setting('transaction_read_only') as "readOnly"`)
    if (settings[0]?.readOnly !== 'on') throw new Error('nutrition_binding_readonly_required')
    const rows = await client.query(`select
      count(*) filter (where account_role = 'client')::integer as clients,
      count(*) filter (where account_role = 'trainer')::integer as trainers,
      count(*) filter (where not (account_role = 'client' and login_sha256 = any($1::text[])
        or account_role = 'trainer' and login_sha256 = any($2::text[])))::integer as outside
      from app_private.nutrition_native_bindings`, [clients, trainers])
    const result = rows[0]
    const count = (value: unknown): number => {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('nutrition_binding_report_rejected')
      return value
    }
    const report = { boundClients: count(result?.clients), boundTrainers: count(result?.trainers), outside: count(result?.outside) }
    if (report.outside !== 0 || report.boundClients > clients.length || report.boundTrainers > trainers.length) {
      throw new Error('nutrition_binding_capacity_conflict')
    }
    await client.query('commit')
    return report
  } catch (error) { await client.query('rollback'); throw error }
}

async function main() {
  const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
  const pilot = readNativeNutritionPilot(process.env.NUTRITION_ENABLED, process.env.NUTRITION_LOGIN_COHORT)
  if (config?.host !== '10.70.10.67' || config.port !== 5432 || config.database !== 'fit' || config.user !== 'fit_owner'
    || process.env.MIGRATION_DATABASE_SSL_MODE !== 'require' || process.env.MIGRATION_DATABASE_URL !== undefined
    || !pilot?.native) throw new Error('nutrition_binding_target_rejected')
  const client = new Client({ ...config, connectionTimeoutMillis: 5000, query_timeout: 5000 })
  await client.connect()
  try {
    const wrapper: DatabaseClient = { query: async <Row extends QueryResultRow>(sql: string, values: readonly unknown[] = []) =>
      (await client.query<Row>(sql, [...values])).rows }
    const report = await inspectNutritionBindings(wrapper, pilot.clients, pilot.trainers)
    console.log(JSON.stringify({ event: 'nutrition_binding_capacity_verified', ...report }))
  } finally { await client.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('nutrition_binding_audit_failed_closed'); process.exitCode = 1 })
}
