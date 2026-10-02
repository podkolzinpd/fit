import assert from 'node:assert/strict'
import test from 'node:test'
import { extractCriticalAssets, probeProductionFrontend } from './probe-production-frontend.mjs'

const timings = { tcpMs: 24, tlsMs: 60, ttfbMs: 210, totalMs: 230 }
const html = '<title>Fit</title><script type="module" src="/assets/app-123.js"></script>'
  + '<link rel="stylesheet" href="/assets/app-123.css">'

test('extracts only static critical assets, never query parameters', () => {
  assert.deepEqual(extractCriticalAssets(html + '<script src="/assets/other.js?token=secret"></script>'), [
    '/assets/app-123.js', '/assets/app-123.css',
  ])
})

test('probes every resolved IP with the same host and checks critical assets', async () => {
  const calls = []
  const report = await probeProductionFrontend({
    sources: [{ name: 'system' }, { name: 'yandex' }],
    resolveAddresses: async (source) => ({ name: source.name, dnsMs: 4,
      ips: source.name === 'system' ? ['203.0.113.1'] : ['203.0.113.2'] }),
    measure: async (ip, path, options) => {
      calls.push({ ip, path, method: options?.method ?? 'GET' })
      return path === '/auth'
        ? { status: 200, contentType: 'text/html', body: html, timings }
        : { status: 200, contentType: 'application/javascript', body: '', timings }
    },
  })
  assert.equal(report.status, 'passed')
  assert.deepEqual(calls, [
    { ip: '203.0.113.1', path: '/auth', method: 'GET' },
    { ip: '203.0.113.2', path: '/auth', method: 'GET' },
    { ip: '203.0.113.1', path: '/assets/app-123.js', method: 'HEAD' },
    { ip: '203.0.113.1', path: '/assets/app-123.css', method: 'HEAD' },
  ])
  assert.doesNotMatch(JSON.stringify(report), /token=|<title>|app-123/)
})

test('reports an unhealthy edge even when another resolver returns a healthy IP', async () => {
  const report = await probeProductionFrontend({
    sources: [{ name: 'system' }, { name: 'yandex' }],
    resolveAddresses: async (source) => ({ name: source.name, dnsMs: 5,
      ips: [source.name === 'system' ? '203.0.113.1' : '203.0.113.2'] }),
    measure: async (ip, path) => ip === '203.0.113.2' && path === '/auth'
      ? { status: null, error: 'ETIMEDOUT', timings: { tcpMs: null, tlsMs: null, ttfbMs: null, totalMs: 12000 } }
      : { status: 200, contentType: 'text/html', body: html, timings },
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.requests.find((result) => result.ip === '203.0.113.2')?.error, 'ETIMEDOUT')
})

test('detects slow HTML before the application session starts', async () => {
  const report = await probeProductionFrontend({
    sources: [{ name: 'system' }],
    resolveAddresses: async () => ({ name: 'system', dnsMs: 2, ips: ['203.0.113.1'] }),
    measure: async (_ip, path) => ({ status: 200, contentType: 'text/html', body: html,
      timings: { ...timings, ttfbMs: path === '/auth' ? 8000 : 210,
        totalMs: path === '/auth' ? 8200 : 230 } }),
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.requests[0].slow, true)
})
