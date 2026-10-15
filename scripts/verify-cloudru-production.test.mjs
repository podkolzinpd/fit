import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { probeProduction, verifyCloudruProduction } from './verify-cloudru-production.mjs'

const release = 'a'.repeat(40)
const healthy = {
  resolveHost: async () => [{ address: '87.242.117.210' }],
  probe: async (_host, path) => ({ status: path.endsWith('/v1/clients') ? 401 : 200,
    certificateValidDays: 60, ...(path.endsWith('/health') ? { release } : {}) }),
}

test('verifies DNS, all web entry points, API readiness and authentication guard', async () => {
  const result = await verifyCloudruProduction({ ...healthy, expectedRelease: release })
  assert.equal(result.status, 'passed')
  assert.equal(result.dns.length, 3)
  assert.equal(result.checks.length, 8)
})

test('a web SPA fallback returning HTTP 200 cannot masquerade as a working API proxy', async () => {
  const probe = async (host, path) => path.startsWith('/api/')
    ? { status: 200, certificateValidDays: 60 }
    : healthy.probe(host, path)
  assert.equal((await verifyCloudruProduction({ ...healthy, probe })).status, 'failed')
})

test('detects stale or missing DNS even while HTTP appears healthy', async () => {
  for (const resolveHost of [async () => [{ address: '158.160.171.31' }], async () => [],
    async () => [{ address: '87.242.117.210' }, { address: '158.160.171.31' }],
    async () => { throw new Error('private resolver failure') }]) {
    const result = await verifyCloudruProduction({ ...healthy, resolveHost })
    assert.equal(result.status, 'failed')
    assert.ok(!JSON.stringify(result).includes('private'))
  }
})

test('rejects an exposed endpoint, network failure, expiring TLS or stale API release', async () => {
  for (const probe of [async () => ({ status: 200, certificateValidDays: 60, release }),
    async () => ({ error: 'request_failed' }),
    async (_host, path) => ({ ...await healthy.probe(_host, path), certificateValidDays: 13 }),
    async (_host, path) => ({ ...await healthy.probe(_host, path), release: 'b'.repeat(40) })]) {
    assert.equal((await verifyCloudruProduction({ ...healthy, probe, expectedRelease: release })).status, 'failed')
  }
})

test('never permits arbitrary destinations or unreviewed routes', () => {
  assert.throws(() => probeProduction('private.example', '/health'))
  assert.throws(() => probeProduction('api.fit-training.ru', '/v1/profile'))
})

test('scheduled production monitor has no credentials and preserves its safe report on failure', () => {
  const workflow = readFileSync(new URL('../.github/workflows/verify-cloudru-production.yml', import.meta.url), 'utf8')
  assert.match(workflow, /cron: '\*\/15 \* \* \* \*'/)
  assert.match(workflow, /if: always\(\)/)
  assert.match(workflow, /timeout-minutes: 5/)
  assert.doesNotMatch(workflow, /secrets\.|id-token: write|sudo|yc |ssh |workflow_run:/)
})
