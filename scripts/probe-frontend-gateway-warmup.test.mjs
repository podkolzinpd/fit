import assert from 'node:assert/strict'
import test from 'node:test'
import { probeFrontendGatewayWarmup } from './probe-frontend-gateway-warmup.mjs'

const timings = { tcpMs: 5, tlsMs: 20, ttfbMs: 100, downloadMs: 2, totalMs: 127 }
const html = '<!doctype html><title>Fit</title>'

test('pairs dummy and HTML on each resolved IP without retaining response bodies', async () => {
  const calls = []
  const report = await probeFrontendGatewayWarmup({
    resolveAddresses: async () => ({ dnsMs: 2, ips: ['203.0.113.1', '203.0.113.2'] }),
    measure: async (ip, path, options) => {
      calls.push({ ip, path, timeoutMs: options.timeoutMs })
      return { status: 200, contentType: path === '/healthz' ? 'text/plain' : 'text/html',
        body: path === '/healthz' ? 'fit-gateway-ready' : html, timings }
    },
  })
  assert.equal(report.status, 'passed')
  assert.deepEqual(calls, [
    { ip: '203.0.113.1', path: '/healthz', timeoutMs: 20_000 },
    { ip: '203.0.113.1', path: '/auth', timeoutMs: 20_000 },
    { ip: '203.0.113.2', path: '/healthz', timeoutMs: 20_000 },
    { ip: '203.0.113.2', path: '/auth', timeoutMs: 20_000 },
  ])
  assert.doesNotMatch(JSON.stringify(report), /<title>|fit-gateway-ready/)
})

test('slow dummy and fast HTML are reported without failing the scheduled job', async () => {
  const report = await probeFrontendGatewayWarmup({
    resolveAddresses: async () => ({ dnsMs: 2, ips: ['203.0.113.1'] }),
    measure: async (_ip, path) => ({ status: 200,
      contentType: path === '/healthz' ? 'text/plain' : 'text/html',
      body: path === '/healthz' ? 'fit-gateway-ready' : html,
      timings: { ...timings, ttfbMs: path === '/healthz' ? 9_000 : 100 } }),
  })
  assert.equal(report.status, 'slow')
  assert.deepEqual(report.requests.map(({ slow }) => slow), [true, false])
})

test('SPA fallback on /healthz and DNS failure are explicit failures', async () => {
  const fallback = await probeFrontendGatewayWarmup({
    resolveAddresses: async () => ({ dnsMs: 2, ips: ['203.0.113.1'] }),
    measure: async () => ({ status: 200, contentType: 'text/html', body: html, timings }),
  })
  assert.equal(fallback.status, 'failed')
  assert.equal(fallback.requests[0].passed, false)

  const dnsFailure = await probeFrontendGatewayWarmup({
    resolveAddresses: async () => ({ dnsMs: 2, ips: [], error: 'ETIMEDOUT' }),
  })
  assert.equal(dnsFailure.status, 'failed')
  assert.deepEqual(dnsFailure.requests, [])
})
