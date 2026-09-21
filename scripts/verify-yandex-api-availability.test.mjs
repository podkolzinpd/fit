import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyYandexApiAvailability } from './verify-yandex-api-availability.mjs'

function healthResponse({
  status = 200,
  releaseId = 'release-1',
  headers = {},
} = {}) {
  return new Response(
    JSON.stringify({ status: 'ok', releaseId }),
    { status, headers },
  )
}

test('sends the requested sequential probes exactly once without hidden retries', async () => {
  let calls = 0
  const delays = []
  const report = await verifyYandexApiAvailability({
    url: 'https://api.example.test/',
    expectedReleaseId: 'release-1',
    count: 3,
    intervalMs: 25,
    sleep: async (delay) => { delays.push(delay) },
    fetch_: async (url, options) => {
      calls += 1
      assert.equal(url, 'https://api.example.test/health')
      assert.equal(options.headers.Authorization, 'Bearer token')
      return healthResponse()
    },
    authorizationToken: 'token',
  })

  assert.equal(calls, 3)
  assert.deepEqual(delays, [25, 25])
  assert.equal(report.status, 'passed')
  assert.equal(report.successfulProbes, 3)
  assert.equal(report.completedProbes, 3)
  assert.equal(report.failureCategory, null)
})

test('classifies an upstream 502 without an app request id as a platform failure', async () => {
  let calls = 0
  const report = await verifyYandexApiAvailability({
    url: 'https://api.example.test',
    expectedReleaseId: 'release-1',
    count: 10,
    fetch_: async () => {
      calls += 1
      return new Response('invocation failed', {
        status: 502,
        headers: { 'x-request-id': 'platform-request-1' },
      })
    },
  })

  assert.equal(calls, 1)
  assert.equal(report.status, 'failed')
  assert.equal(report.failureCategory, 'platform')
  assert.deepEqual(report.firstFailure, {
    probe: 1,
    category: 'platform',
    httpStatus: 502,
    platformRequestId: 'platform-request-1',
    fitRequestId: null,
    reason: 'http_error',
  })
})

test('classifies a response carrying an app request id as an application failure', async () => {
  const report = await verifyYandexApiAvailability({
    url: 'https://api.example.test',
    expectedReleaseId: 'release-1',
    count: 1,
    fetch_: async () => new Response('unavailable', {
      status: 503,
      headers: { 'x-fit-request-id': 'fit-request-1' },
    }),
  })

  assert.equal(report.failureCategory, 'application')
  assert.equal(report.firstFailure.fitRequestId, 'fit-request-1')
})

test('rejects a healthy response from an unexpected release as application drift', async () => {
  const report = await verifyYandexApiAvailability({
    url: 'https://api.example.test',
    expectedReleaseId: 'release-1',
    count: 1,
    fetch_: async () => healthResponse({ releaseId: 'old-release' }),
  })

  assert.equal(report.failureCategory, 'application')
  assert.equal(report.firstFailure.reason, 'unexpected_health_contract')
})

test('classifies a network interruption as a platform failure and does not retry it', async () => {
  let calls = 0
  const report = await verifyYandexApiAvailability({
    url: 'https://api.example.test',
    expectedReleaseId: 'release-1',
    count: 500,
    fetch_: async () => {
      calls += 1
      throw new TypeError('network failed')
    },
  })

  assert.equal(calls, 1)
  assert.equal(report.failureCategory, 'platform')
  assert.equal(report.firstFailure.reason, 'network_or_timeout')
})
