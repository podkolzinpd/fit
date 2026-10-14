import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeCloudruAiEnv } from './configure-cloudru-ai.mjs'

const base = 'DATABASE_HOST=10.70.10.67\nDATABASE_PORT=5432\nDATABASE_NAME=fit\nDATABASE_USER=fit_api\nDATABASE_SSL_MODE=require\nFIT_MEDIA_STORAGE_PROVIDER=cloudru\nFIT_AI_FUNCTIONS_ENABLED=false\nFIT_AI_SUMMARY_GENERATION_DISABLED=true\nCLOUDRU_MEDIA_KEY_SECRET=synthetic-media-key\n'
const external = 'YANDEX_CLOUD_API_KEY=synthetic-ai-key\nYANDEX_CLOUD_FOLDER_ID=synthetic-folder\nYANDEX_CLOUD_MODEL_ID=yandexgpt\n'

test('enables external AI while preserving exact Cloud.ru database and media settings', () => {
  const next = mergeCloudruAiEnv(base, external)
  assert.ok(next.includes('FIT_AI_FUNCTIONS_ENABLED=true\n'))
  assert.ok(next.includes('CLOUDRU_MEDIA_KEY_SECRET=synthetic-media-key\n'))
  assert.ok(next.includes('DATABASE_USER=fit_api\n'))
  assert.equal(mergeCloudruAiEnv(next, external), next)
})

test('rejects extra credentials and never copies Supabase or database owner configuration', () => {
  for (const value of [external + 'SUPABASE_SERVICE_ROLE_KEY=synthetic\n',
    external.replace('YANDEX_CLOUD_FOLDER_ID=synthetic-folder', 'DATABASE_USER=fit_owner'),
    external.replace('synthetic-ai-key', 'bad\rvalue'), external + external]) {
    assert.throws(() => mergeCloudruAiEnv(base, value))
  }
})
