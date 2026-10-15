import assert from 'node:assert/strict'
import test from 'node:test'
import { checkCloudruApiEnv } from './check-cloudru-api-env.mjs'

const base = 'DATABASE_HOST=10.70.10.67\nDATABASE_PORT=5432\nDATABASE_NAME=fit\nDATABASE_USER=fit_api\nDATABASE_SSL_MODE=require\nFIT_MEDIA_STORAGE_PROVIDER=cloudru\n'
const disabled = 'FIT_AI_FUNCTIONS_ENABLED=false\nFIT_AI_SUMMARY_GENERATION_DISABLED=true\n'
const enabled = 'FIT_AI_FUNCTIONS_ENABLED=true\nFIT_AI_SUMMARY_GENERATION_DISABLED=false\nYANDEX_CLOUD_API_KEY=synthetic-key\nYANDEX_CLOUD_FOLDER_ID=synthetic-folder\n'

test('supports explicit disabled runtime and configured external AI without changing its database role', () => {
  assert.deepEqual(checkCloudruApiEnv(base + disabled), { aiEnabled: false })
  assert.deepEqual(checkCloudruApiEnv(base + enabled), { aiEnabled: true })
})

test('rejects owner credentials, other databases, duplicate fields and VM metadata dependencies', () => {
  for (const text of [
    (base + disabled).replace('DATABASE_USER=fit_api', 'DATABASE_USER=fit_owner'),
    (base + disabled).replace('10.70.10.67', 'yandex.example'),
    base + disabled + 'MIGRATION_DATABASE_PASSWORD=synthetic\n',
    base + disabled + 'FIT_AI_FUNCTIONS_ENABLED=true\n',
    base + enabled + 'YANDEX_CLOUD_USE_METADATA_IAM_TOKEN=true\n',
    base + enabled + 'ASSISTANT_PROGRAM_GENERATOR_URL=https://old.example\n',
    base + enabled.replace('YANDEX_CLOUD_API_KEY=synthetic-key\n', ''),
  ]) assert.throws(() => checkCloudruApiEnv(text))
})
