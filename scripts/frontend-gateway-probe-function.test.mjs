import assert from 'node:assert/strict'
import test from 'node:test'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createFrontendProbeHandler } from './frontend-gateway-probe-function.mjs'
import { probeFrontendGatewayWarmup } from './probe-frontend-gateway-warmup.mjs'

const now = () => Date.parse('2026-10-05T12:00:00Z')
const expiresAt = '2026-10-06T12:00:00Z'

test('the exact deployment package loads index.handler without dependencies or network', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'fit-frontend-probe-test-'))
  t.after(() => rm(dir, { recursive: true }))
  await cp(new URL('../infra/frontend-probe/package.json', import.meta.url), join(dir, 'package.json'))
  await cp(new URL('./frontend-gateway-probe-entry.mjs', import.meta.url), join(dir, 'index.js'))
  for (const file of ['frontend-gateway-probe-function.mjs', 'frontend-gateway-health.mjs',
    'probe-frontend-gateway-warmup.mjs', 'probe-production-frontend.mjs']) {
    await cp(new URL(file, import.meta.url), join(dir, file))
  }
  const previous = process.env.PROBE_EXPIRES_AT
  process.env.PROBE_EXPIRES_AT = '2000-01-01T00:00:00Z'
  try {
    const entry = await import(pathToFileURL(join(dir, 'index.js')).href)
    assert.deepEqual(await entry.handler(), { status: 'expired' })
  } finally {
    if (previous === undefined) delete process.env.PROBE_EXPIRES_AT
    else process.env.PROBE_EXPIRES_AT = previous
  }
})

test('cloud handler bounds the probe to one IP and never logs invocation data', async () => {
  const logs = []
  const calls = []
  const handler = createFrontendProbeHandler({ now, expiresAt, log: (report) => logs.push(report),
    probe: (options) => {
      assert.equal(options.network, 'yandex-cloud')
      assert.equal(options.maxAddresses, 1)
      return probeFrontendGatewayWarmup({ ...options,
        resolveAddresses: async () => ({ dnsMs: 2, ips: ['203.0.113.1', '203.0.113.2'] }),
        measure: async (ip, path, config) => {
          calls.push({ ip, path, timeoutMs: config.timeoutMs })
          return { status: 200, contentType: path === '/healthz' ? 'text/plain' : 'text/html',
            body: path === '/healthz' ? 'fit-gateway-ready' : '<title>Fit</title>private-body',
            timings: { ttfbMs: 100, totalMs: 120 } }
        } })
    } })
  assert.deepEqual(await handler({ token: 'private-token' }), { status: 'passed', measured: true, requests: 2 })
  assert.deepEqual(calls, [
    { ip: '203.0.113.1', path: '/healthz', timeoutMs: 20_000 },
    { ip: '203.0.113.1', path: '/auth', timeoutMs: 20_000 },
  ])
  assert.equal(logs.length, 1)
  assert.doesNotMatch(JSON.stringify(logs), /private-|<title>|fit-gateway-ready/)
})

test('measured failure is successful invocation data, without a hidden retry', async () => {
  let calls = 0
  const handler = createFrontendProbeHandler({ now, expiresAt, log: () => {},
    probe: async () => { calls += 1; return { status: 'failed', requests: [] } } })
  assert.deepEqual(await handler(), { status: 'failed', measured: true, requests: 0 })
  assert.equal(calls, 1)
})

test('24-hour expiry stops traffic; absent/invalid expiry fails closed', async () => {
  let calls = 0
  const probe = async () => { calls += 1 }
  const handler = createFrontendProbeHandler({ now, expiresAt: '2026-10-05T12:00:00Z', probe })
  assert.deepEqual(await handler(), { status: 'expired' })
  for (const invalid of [undefined, 'invalid']) {
    await assert.rejects(createFrontendProbeHandler({ now, expiresAt: invalid, probe })(), /required/)
  }
  assert.equal(calls, 0)
})
