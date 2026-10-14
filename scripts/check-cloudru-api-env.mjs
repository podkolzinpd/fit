import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function checkCloudruApiEnv(text) {
  const values = new Map()
  for (const line of text.split('\n').filter(Boolean)) {
    const match = /^([A-Z][A-Z0-9_]*)=([^\x00-\x1f\x7f]*)$/.exec(line)
    if (!match || values.has(match[1])) throw new Error('cloudru_runtime_env_rejected')
    values.set(match[1], match[2])
  }
  for (const [key, value] of Object.entries({ DATABASE_HOST: '10.70.10.67', DATABASE_PORT: '5432',
    DATABASE_NAME: 'fit', DATABASE_USER: 'fit_api', DATABASE_SSL_MODE: 'require', FIT_MEDIA_STORAGE_PROVIDER: 'cloudru' })) {
    if (values.get(key) !== value) throw new Error('cloudru_runtime_target_rejected')
  }
  if ([...values.keys()].some(key => key.startsWith('MIGRATION_DATABASE_'))
    || values.has('DATABASE_URL')) throw new Error('cloudru_runtime_owner_rejected')
  const enabled = values.get('FIT_AI_FUNCTIONS_ENABLED')
  if (!['true', 'false'].includes(enabled)
    || values.get('FIT_AI_SUMMARY_GENERATION_DISABLED') !== (enabled === 'true' ? 'false' : 'true')) {
    throw new Error('cloudru_runtime_ai_rejected')
  }
  if (enabled === 'true' && (!values.get('YANDEX_CLOUD_API_KEY') || !values.get('YANDEX_CLOUD_FOLDER_ID')
    || values.get('YANDEX_CLOUD_USE_METADATA_IAM_TOKEN') === 'true'
    || values.get('YANDEX_LLM_FUNCTION_URL') || values.get('ASSISTANT_PROGRAM_GENERATOR_URL'))) {
    throw new Error('cloudru_runtime_ai_rejected')
  }
  return { aiEnabled: enabled === 'true' }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkCloudruApiEnv(readFileSync('/opt/fit/secrets/api.env', 'utf8'))
    console.log(JSON.stringify({ event: 'cloudru_runtime_configuration_valid', ...result }))
  } catch { console.error('cloudru_runtime_configuration_rejected'); process.exitCode = 1 }
}
