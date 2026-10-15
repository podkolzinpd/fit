import assert from 'node:assert/strict'
import test from 'node:test'
import { readCloudruExternalCredentials } from './read-cloudru-external-credentials.mjs'

const environment = { GITHUB_REPOSITORY: 'podkolzinpd/fit', GITHUB_REF: 'refs/heads/main',
  YC_DEPLOY_SA_ID: 'syntheticsa', YC_FOLDER_ID: 'syntheticfolder',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://test.actions.githubusercontent.com/token',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-request', EXPECTED_VAPID_PUBLIC_KEY: 'synthetic-public' }

function fixture(overrides = {}) {
  const calls = []
  const replies = [{ value: 'synthetic-oidc' }, { access_token: 'synthetic-iam' },
    { secrets: [{ name: 'fit-summarize-client-training-supabase', id: 'syntheticsecret', currentVersion: { id: 'v1' } }] },
    { versionId: 'v1', entries: [
      { key: 'YANDEX_CLOUD_API_KEY', textValue: 'synthetic-key' },
      { key: 'YANDEX_CLOUD_FOLDER_ID', textValue: 'synthetic-folder' },
      { key: 'YANDEX_CLOUD_MODEL_ID', textValue: 'yandexgpt' },
      { key: 'SUPABASE_SERVICE_ROLE_KEY', textValue: 'must-not-copy' },
    ], ...overrides }]
  return { calls, request: async (url, options) => {
    calls.push({ url: String(url), options })
    return new Response(JSON.stringify(replies.shift()), { status: 200 })
  } }
}

test('reads a pinned existing credential version and copies only the required external API settings', async () => {
  const { calls, request } = fixture()
  const result = await readCloudruExternalCredentials('ai', environment, request)
  assert.equal(result, 'YANDEX_CLOUD_API_KEY=synthetic-key\nYANDEX_CLOUD_FOLDER_ID=synthetic-folder\nYANDEX_CLOUD_MODEL_ID=yandexgpt\n')
  assert.equal(calls.length, 4)
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1)
  assert.ok(calls[3].url.endsWith('/syntheticsecret/payload?versionId=v1'))
  assert.ok(!result.includes('SUPABASE'))
})

test('refuses untrusted branch, secret families, malformed values and version drift', async () => {
  await assert.rejects(readCloudruExternalCredentials('ai', { ...environment, GITHUB_REF: 'refs/pull/1/head' }), /context_rejected/)
  await assert.rejects(readCloudruExternalCredentials('database', environment), /context_rejected/)
  for (const overrides of [{ versionId: 'v2' }, { entries: [{ key: 'YANDEX_CLOUD_API_KEY', textValue: 'bad\nINJECT=value' }] }]) {
    await assert.rejects(readCloudruExternalCredentials('ai', environment, fixture(overrides).request))
  }
})
