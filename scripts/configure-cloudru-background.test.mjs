import assert from 'node:assert/strict'
import test from 'node:test'
import { backgroundEnvironment } from './configure-cloudru-background.mjs'

const api = 'DATABASE_HOST=10.70.10.67\nDATABASE_PORT=5432\nDATABASE_NAME=fit\nDATABASE_USER=fit_api\nDATABASE_PASSWORD=synthetic-db\nDATABASE_SSL_MODE=require\nFIT_MEDIA_STORAGE_PROVIDER=cloudru\nFIT_AI_FUNCTIONS_ENABLED=false\nFIT_AI_SUMMARY_GENERATION_DISABLED=true\nCLOUDRU_MEDIA_KEY_SECRET=must-not-copy\n'
const push = 'VAPID_PUBLIC_KEY=synthetic-public\nVAPID_PRIVATE_KEY=synthetic-private\nVAPID_SUBJECT=https://example.test\n'

test('worker receives only least-privilege DB credentials and the existing VAPID identity', () => {
  const next = backgroundEnvironment(api, push)
  assert.ok(next.includes('DATABASE_USER=fit_api\n'))
  assert.ok(next.includes(push))
  assert.ok(!next.includes('MEDIA_KEY_SECRET'))
  assert.ok(!next.includes('FIT_AI_FUNCTIONS'))
  assert.equal(next.split('\n').filter(Boolean).length, 10)
})

test('worker configuration refuses unexpected secrets, missing DB fields and duplicate VAPID entries', () => {
  for (const value of [push + 'YANDEX_CLOUD_API_KEY=unexpected\n', push + push, push.replace('synthetic-private', 'bad\nINJECT=value')]) {
    assert.throws(() => backgroundEnvironment(api, value))
  }
  assert.throws(() => backgroundEnvironment(api.replace('DATABASE_PASSWORD=synthetic-db\n', ''), push))
})
