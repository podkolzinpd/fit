import assert from 'node:assert/strict'
import test from 'node:test'

import { syncSupabasePushTransport } from './sync-supabase-push-transport.mjs'

const INPUT = {
  accessToken: 'supabase-management-token',
  dispatchSecret: 'a'.repeat(43),
  functionUrl: 'https://functions.yandexcloud.net/function-id',
  projectId: 'abcdefghijklmnopqrst',
}

test('upserts and verifies push transport with parameterized Supabase queries', async () => {
  const calls = []
  const fetch_ = async (url, options) => {
    calls.push({ options, url })
    return { ok: true, status: 201 }
  }

  await syncSupabasePushTransport(INPUT, { fetch: fetch_ })

  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.url, 'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query')
    assert.equal(call.options.method, 'POST')
    assert.equal(call.options.headers.authorization, 'Bearer supabase-management-token')
    const body = JSON.parse(call.options.body)
    assert.deepEqual(body.parameters, [INPUT.functionUrl, INPUT.dispatchSecret])
    assert.doesNotMatch(body.query, new RegExp(INPUT.dispatchSecret))
    assert.doesNotMatch(body.query, /function-id/)
  }
  assert.match(JSON.parse(calls[0].options.body).query, /vault\.update_secret/)
  assert.match(JSON.parse(calls[0].options.body).query, /vault\.create_secret/)
  assert.match(JSON.parse(calls[1].options.body).query, /vault\.decrypted_secrets/)
})

test('rejects a non-Yandex function URL before sending credentials', async () => {
  let called = false
  await assert.rejects(
    syncSupabasePushTransport(
      { ...INPUT, functionUrl: 'https://example.test/collect' },
      { fetch: async () => { called = true } },
    ),
    /Yandex Cloud Functions HTTPS URL/,
  )
  assert.equal(called, false)
})

test('reports only the HTTP status when Supabase rejects the request', async () => {
  await assert.rejects(
    syncSupabasePushTransport(INPUT, {
      fetch: async () => ({ ok: false, status: 403 }),
    }),
    (error) => {
      assert.match(error.message, /HTTP 403/)
      assert.doesNotMatch(error.message, new RegExp(INPUT.dispatchSecret))
      assert.doesNotMatch(error.message, /supabase-management-token/)
      return true
    },
  )
})
