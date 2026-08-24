import assert from 'node:assert/strict'
import { test } from 'node:test'

import { verifyYandexFunctionRelease } from './verify-yandex-function-release.mjs'

const input = {
  functionName: 'fit-function',
  folderId: 'folder-id',
  expectedVersionId: 'new-version',
  previousVersionId: 'previous-version',
  attempts: 2,
  delayMs: 0,
}

function ycFixture({ latest = 'new-version', status = 'ACTIVE' } = {}) {
  const calls = []
  const yc = (arguments_) => {
    calls.push(arguments_)
    if (arguments_.includes('set-tag')) return '{}'
    if (arguments_.includes('get-by-tag')) {
      const rolledBack = calls.some((call) => call.includes('set-tag'))
      return JSON.stringify({ id: rolledBack ? 'previous-version' : latest, status })
    }
    return JSON.stringify({ http_invoke_url: 'https://function.example.test' })
  }
  return { calls, yc }
}

test('accepts an active latest version after the authentication smoke', async () => {
  const fixture = ycFixture()
  const result = await verifyYandexFunctionRelease(input, {
    yc: fixture.yc,
    fetch: async () => ({ status: 401 }),
    sleep: async () => {},
  })

  assert.deepEqual(result, {
    functionUrl: 'https://function.example.test',
    versionId: 'new-version',
    rolledBack: false,
  })
  assert.equal(fixture.calls.some((call) => call.includes('set-tag')), false)
})

test('retries the public authentication gate before succeeding', async () => {
  const fixture = ycFixture()
  let attempts = 0
  await verifyYandexFunctionRelease(input, {
    yc: fixture.yc,
    fetch: async () => ({ status: ++attempts === 1 ? 503 : 401 }),
    sleep: async () => {},
  })
  assert.equal(attempts, 2)
})

test('restores the previous latest tag when smoke fails', async () => {
  const fixture = ycFixture()

  await assert.rejects(
    verifyYandexFunctionRelease(input, {
      yc: fixture.yc,
      fetch: async () => ({ status: 500 }),
      sleep: async () => {},
    }),
    /authentication smoke failed.*rolled back to previous-version/,
  )

  const rollback = fixture.calls.find((call) => call.includes('set-tag'))
  assert.ok(rollback)
  assert.deepEqual(rollback.slice(-4), ['--folder-id', 'folder-id', '--tag', '$latest'])
  assert.ok(rollback.includes('previous-version'))
})

test('fails safely when the first version has no rollback target', async () => {
  const fixture = ycFixture({ status: 'CREATING' })

  await assert.rejects(
    verifyYandexFunctionRelease({ ...input, previousVersionId: '' }, {
      yc: fixture.yc,
      fetch: async () => ({ status: 401 }),
      sleep: async () => {},
    }),
    /no previous version is available for rollback/,
  )
  assert.equal(fixture.calls.some((call) => call.includes('set-tag')), false)
})

test('reports a rollback verification failure separately', async () => {
  const calls = []
  const yc = (arguments_) => {
    calls.push(arguments_)
    if (arguments_.includes('get-by-tag')) return JSON.stringify({ id: 'new-version', status: 'ACTIVE' })
    if (arguments_.includes('set-tag')) return '{}'
    return JSON.stringify({ http_invoke_url: 'https://function.example.test' })
  }

  await assert.rejects(
    verifyYandexFunctionRelease(input, {
      yc,
      fetch: async () => ({ status: 500 }),
      sleep: async () => {},
    }),
    /rollback failed: \$latest was not restored/,
  )
})
