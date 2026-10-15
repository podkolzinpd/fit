import { Pool } from 'pg'
import { pathToFileURL } from 'node:url'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { readNativeNutritionPilot } from './nutrition-pilot.js'

const failureReasons = new Set(['cloudru_nutrition_target_rejected', 'cloudru_nutrition_cohort_rejected',
  'cloudru_nutrition_probe_empty', 'cloudru_nutrition_bind_execute_missing', 'cloudru_nutrition_cap_four_missing',
  'cloudru_nutrition_metadata_read_denied'])

export function nutritionSmokeFailureReason(error: unknown): string {
  if (error instanceof Error && failureReasons.has(error.message)) return error.message
  // Only static reason codes, never the driver message, SQL, env or cohort.
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === '42501') return 'cloudru_nutrition_database_permission_denied'
    if (error.code === '42883' || error.code === '3F000') return 'cloudru_nutrition_function_missing'
    if (error.code === '28P01' || error.code === '28000') return 'cloudru_nutrition_database_auth_failed'
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === '08006') return 'cloudru_nutrition_database_unavailable'
  }
  return 'cloudru_nutrition_smoke_failed'
}

export async function smokeCloudruNutrition(): Promise<void> {
  const config = buildDatabaseConnectionConfig('DATABASE')
  const pilot = readNativeNutritionPilot(process.env.NUTRITION_ENABLED, process.env.NUTRITION_LOGIN_COHORT)
  if (process.env.FIT_MEDIA_STORAGE_PROVIDER !== 'cloudru' || config?.host !== '10.70.10.67'
    || config.user !== 'fit_api' || config.database !== 'fit') throw new Error('cloudru_nutrition_target_rejected')
  if (!pilot?.native || pilot.clients.length !== 4 || pilot.trainers.length !== 2) throw new Error('cloudru_nutrition_cohort_rejected')
  const pool = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 })
  try {
    const access = await pool.query<{ allowed: boolean }>(`select
      has_function_privilege(current_user, 'app_private.bind_nutrition_for_yandex_login(text,text,text)', 'EXECUTE') allowed`)
    if (!access.rows[0]) throw new Error('cloudru_nutrition_probe_empty')
    if (!access.rows[0].allowed) throw new Error('cloudru_nutrition_bind_execute_missing')
    // Separate service execution rights from catalog-introspection rights.
    // Neither failure permits activation; no role grants are changed here.
    try {
      const result = await pool.query<{ definition: string }>(`select
        pg_get_functiondef('app_private.bind_nutrition_for_yandex_login(text,text,text)'::regprocedure) definition`)
      if (!result.rows[0]) throw new Error('cloudru_nutrition_probe_empty')
      if (!/then\s+4\s+else\s+2\s+end/iu.test(result.rows[0].definition)) throw new Error('cloudru_nutrition_cap_four_missing')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
        throw new Error('cloudru_nutrition_metadata_read_denied', { cause: error })
      }
      throw error
    }
  } finally { await pool.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeCloudruNutrition().then(() => { console.log('{"event":"cloudru_nutrition_runtime_verified","clients":4,"trainers":2}') })
    .catch((error: unknown) => {
      console.error(JSON.stringify({ event: 'cloudru_nutrition_smoke_failed', reason: nutritionSmokeFailureReason(error) }))
      process.exitCode = 1
    })
}
