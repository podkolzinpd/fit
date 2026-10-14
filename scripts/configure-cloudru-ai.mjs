import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCloudruApiEnv } from './check-cloudru-api-env.mjs'

export function mergeCloudruAiEnv(existing, external) {
  checkCloudruApiEnv(existing)
  const values = new Map(existing.split('\n').filter(Boolean).map(line => {
    const index = line.indexOf('=')
    return [line.slice(0, index), line.slice(index + 1)]
  }))
  const allowed = ['YANDEX_CLOUD_API_KEY', 'YANDEX_CLOUD_FOLDER_ID', 'YANDEX_CLOUD_MODEL_ID']
  const entries = external.trimEnd().split('\n').map(line => /^([A-Z_]+)=([^\x00-\x20\x7f]+)$/.exec(line))
  if (entries.length !== allowed.length || entries.some(entry => !entry || !allowed.includes(entry[1]))
    || new Set(entries.map(entry => entry[1])).size !== allowed.length) throw new Error('cloudru_ai_credentials_rejected')
  for (const entry of entries) values.set(entry[1], entry[2])
  for (const key of ['YANDEX_CLOUD_USE_METADATA_IAM_TOKEN', 'YANDEX_LLM_FUNCTION_URL', 'ASSISTANT_PROGRAM_GENERATOR_URL']) values.delete(key)
  values.set('FIT_AI_FUNCTIONS_ENABLED', 'true')
  values.set('FIT_AI_SUMMARY_GENERATION_DISABLED', 'false')
  values.set('ASSISTANT_PROGRAM_ENABLED', 'true')
  const origins = (values.get('CORS_ALLOWED_ORIGINS') ?? '').split(/[;,]/).map(value => value.trim()).filter(Boolean)
  values.set('CORS_ALLOWED_ORIGINS', [...new Set([...origins, 'https://fit-training.ru',
    'https://www.fit-training.ru', 'capacitor://localhost', 'https://localhost'])].join(','))
  const next = [...values].map(([key, value]) => `${key}=${value}\n`).join('')
  checkCloudruApiEnv(next)
  return next
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const id = process.argv[2]
    if (process.getuid() !== 0 || !/^[0-9]+-[0-9]+$/.test(id ?? '')) throw new Error('rejected')
    const next = mergeCloudruAiEnv(readFileSync('/opt/fit/secrets/api.env', 'utf8'),
      readFileSync(`/opt/fit/secrets/ai-external-${id}.env`, 'utf8'))
    writeFileSync(`/opt/fit/secrets/api-next-${id}.env`, next, { flag: 'wx', mode: 0o600 })
  } catch { console.error('cloudru_ai_configuration_failed'); process.exitCode = 1 }
}
