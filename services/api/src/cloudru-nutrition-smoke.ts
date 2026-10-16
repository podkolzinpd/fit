import { Client } from 'pg'
import { pathToFileURL } from 'node:url'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { readNativeNutritionPilot } from './nutrition-pilot.js'

const failureReasons = new Set(['cloudru_nutrition_target_rejected', 'cloudru_nutrition_cohort_rejected',
  'cloudru_nutrition_probe_empty', 'cloudru_nutrition_bind_execute_missing', 'cloudru_nutrition_capability_mismatch',
  'cloudru_nutrition_metadata_read_denied', 'cloudru_nutrition_readonly_required'])

export function nutritionSmokeFailureReason(error: unknown): string {
  if (error instanceof Error && failureReasons.has(error.message)) return error.message
  // Only static reason codes, never the driver message, SQL, env or cohort.
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === '42501') return 'cloudru_nutrition_database_permission_denied'
    if (error.code === '42883' || error.code === '3F000') return 'cloudru_nutrition_function_missing'
    if (error.code === '28P01' || error.code === '28000') return 'cloudru_nutrition_database_auth_failed'
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === '08006') return 'cloudru_nutrition_database_unavailable'
    if (error.code === '08P01') return 'cloudru_nutrition_database_protocol_rejected'
  }
  return 'cloudru_nutrition_smoke_failed'
}

export async function smokeCloudruNutrition(): Promise<{ clients: number; trainers: number }> {
  const config = buildDatabaseConnectionConfig('DATABASE')
  const pilot = readNativeNutritionPilot(process.env.NUTRITION_ENABLED, process.env.NUTRITION_LOGIN_COHORT)
  if (process.env.FIT_MEDIA_STORAGE_PROVIDER !== 'cloudru' || config?.host !== '10.70.10.67'
    || config.user !== 'fit_api' || config.database !== 'fit') throw new Error('cloudru_nutrition_target_rejected')
  if (!pilot?.native || ![4, 5].includes(pilot.clients.length) || pilot.trainers.length !== 2) throw new Error('cloudru_nutrition_cohort_rejected')
  // Cloud.ru's pooler rejects nonstandard startup parameters (see the verified
  // SQL audit). Keep server limits transaction-local, not in the startup packet.
  const client = new Client({ ...config, connectionTimeoutMillis: 5_000, query_timeout: 5_000 })
  try {
    await client.connect()
    await client.query('begin read only')
    await client.query("set local statement_timeout = '5s'")
    await client.query("set local lock_timeout = '2s'")
    const settings = await client.query<{ readOnly: string; timeout: string }>(`select
      current_setting('transaction_read_only') as "readOnly", current_setting('statement_timeout') as timeout`)
    if (settings.rows[0]?.readOnly !== 'on' || settings.rows[0]?.timeout !== '5s') {
      throw new Error('cloudru_nutrition_readonly_required')
    }
    const access = await client.query<{ allowed: boolean }>(`select
      has_function_privilege(current_user, 'app_private.bind_nutrition_for_yandex_login(text,text,text)', 'EXECUTE') allowed`)
    if (!access.rows[0]) throw new Error('cloudru_nutrition_probe_empty')
    if (!access.rows[0].allowed) throw new Error('cloudru_nutrition_bind_execute_missing')
    // Separate service execution rights from catalog-introspection rights.
    // Neither failure permits activation; no role grants are changed here.
    try {
      const result = await client.query<{ definition: string }>(`select
        pg_get_functiondef('app_private.bind_nutrition_for_yandex_login(text,text,text)'::regprocedure) definition`)
      if (!result.rows[0]) throw new Error('cloudru_nutrition_probe_empty')
      const capacity = /case\s+when\s+p_role\s*=\s*'client'\s+then\s+([45])\s+else\s+2\s+end/iu.exec(result.rows[0].definition)?.[1]
      // A prior four-client configuration may run on cap5 for rollback without
      // Down or deleting data. A five-client configuration requires cap5.
      if (!capacity || Number(capacity) < pilot.clients.length) throw new Error('cloudru_nutrition_capability_mismatch')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
        throw new Error('cloudru_nutrition_metadata_read_denied', { cause: error })
      }
      throw error
    }
    await client.query('commit')
    return { clients: pilot.clients.length, trainers: pilot.trainers.length }
  } finally { await client.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeCloudruNutrition().then(counts => { console.log(JSON.stringify({ event: 'cloudru_nutrition_runtime_verified', ...counts })) })
    .catch((error: unknown) => {
      console.error(JSON.stringify({ event: 'cloudru_nutrition_smoke_failed', reason: nutritionSmokeFailureReason(error) }))
      process.exitCode = 1
    })
}
