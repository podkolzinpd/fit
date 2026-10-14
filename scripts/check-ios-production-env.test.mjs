import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { validateIosProductionEnv } from './check-ios-production-env.mjs'

const valid = { VITE_YANDEX_API_BASE_URL: 'https://api.example.test', VITE_YANDEX_OAUTH_CLIENT_ID: 'public-client-id',
  VITE_YANDEX_APP_SESSION_ENABLED: 'true', VITE_YANDEX_MAIN_ROUTING_ENABLED: 'true',
  VITE_YANDEX_NATIVE_REGISTRATION_ENABLED: 'true', VITE_YANDEX_ONLY_AUTH_ENABLED: 'true' }

test('production native configuration needs no Supabase variables', () => {
  assert.deepEqual(validateIosProductionEnv(valid), [])
})
test('old Supabase variables cannot replace missing native configuration', () => {
  assert.ok(validateIosProductionEnv({ VITE_SUPABASE_URL: 'https://legacy.example.test', VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture' }).length > 0)
})
for (const key of ['VITE_YANDEX_APP_SESSION_ENABLED', 'VITE_YANDEX_MAIN_ROUTING_ENABLED', 'VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'VITE_YANDEX_ONLY_AUTH_ENABLED']) {
  test(`rejects absent or disabled ${key}`, () => {
    for (const value of [undefined, '', 'false', 'TRUE']) assert.ok(validateIosProductionEnv({ ...valid, [key]: value }).includes(`${key} must be true`))
  })
}
for (const origin of [undefined, '', 'not-url', 'http://api.example.test', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://api.example.test/v1', 'https://api.example.test?fixture=1', 'https://fixture:fixture@api.example.test']) {
  test(`rejects unsafe production origin: ${origin}`, () => assert.ok(validateIosProductionEnv({ ...valid, VITE_YANDEX_API_BASE_URL: origin }).length > 0))
}
test('accepts a single trailing slash and validates public OAuth ID', () => {
  assert.deepEqual(validateIosProductionEnv({ ...valid, VITE_YANDEX_API_BASE_URL: 'https://api.example.test/' }), [])
  for (const value of [undefined, '', ' '.repeat(5), 'x'.repeat(201)]) assert.ok(validateIosProductionEnv({ ...valid, VITE_YANDEX_OAUTH_CLIENT_ID: value }).length > 0)
})
for (const name of ['prepare-cloudru-frontend', 'prepare-yandex-frontend', 'deploy-yandex-frontend', 'android-build']) {
  test(`${name} supplies native config without Supabase build env`, async () => {
    const content = await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8')
    assert.doesNotMatch(content, /VITE_SUPABASE_/)
    assert.match(content, /VITE_YANDEX_ONLY_AUTH_ENABLED: 'true'/)
    assert.match(content, /VITE_YANDEX_API_BASE_URL:/)
  })
}
