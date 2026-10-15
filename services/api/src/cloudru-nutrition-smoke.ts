import { Pool } from 'pg'
import { pathToFileURL } from 'node:url'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { readNativeNutritionPilot } from './nutrition-pilot.js'

export async function smokeCloudruNutrition(): Promise<void> {
  const config = buildDatabaseConnectionConfig('DATABASE')
  const pilot = readNativeNutritionPilot(process.env.NUTRITION_ENABLED, process.env.NUTRITION_LOGIN_COHORT)
  if (process.env.FIT_MEDIA_STORAGE_PROVIDER !== 'cloudru' || config?.host !== '10.70.10.67'
    || config.user !== 'fit_api' || config.database !== 'fit' || !pilot?.native
    || pilot.clients.length !== 4 || pilot.trainers.length !== 2) throw new Error('rejected')
  const pool = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 })
  try {
    const result = await pool.query<{ definition: string; allowed: boolean }>(`select
      pg_get_functiondef('app_private.bind_nutrition_for_yandex_login(text,text,text)'::regprocedure) definition,
      has_function_privilege(current_user, 'app_private.bind_nutrition_for_yandex_login(text,text,text)', 'EXECUTE') allowed`)
    const row = result.rows[0]
    if (!row?.allowed || !/then 4 else 2 end/u.test(row.definition)) throw new Error('rejected')
  } finally { await pool.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeCloudruNutrition().then(() => { console.log('{"event":"cloudru_nutrition_runtime_verified","clients":4,"trainers":2}') })
    .catch(() => { console.error('cloudru_nutrition_smoke_failed'); process.exitCode = 1 })
}
