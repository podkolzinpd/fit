import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { frontendHealthBody, frontendHealthPath } from './frontend-gateway-health.mjs'
import { measureFrontendRequest, resolveFrontendAddresses } from './probe-production-frontend.mjs'

const slowThresholdMs = 5_000

export async function probeFrontendGatewayWarmup({
  resolveAddresses = resolveFrontendAddresses,
  measure = measureFrontendRequest,
  maxAddresses = Infinity,
  network = 'github-runner',
} = {}) {
  const checkedAt = new Date().toISOString()
  const dns = await resolveAddresses({ name: 'system' })
  const requests = []
  for (const ip of dns.ips.slice(0, maxAddresses)) {
    // Pair the requests on the same gateway IP: a slow dummy followed by fast
    // HTML is evidence for startup latency, not proof of the root cause.
    for (const path of [frontendHealthPath, '/auth']) {
      const startedAt = new Date().toISOString()
      const response = await measure(ip, path, { timeoutMs: 20_000 })
      const passed = path === frontendHealthPath
        ? response.status === 200 && response.contentType === 'text/plain'
          && response.body === frontendHealthBody
        : response.status === 200 && response.contentType === 'text/html'
          && response.body?.includes('<title>Fit</title>') === true
      requests.push({ startedAt, ip, resource: path === frontendHealthPath ? 'gateway-health' : 'html',
        status: response.status, error: response.error ?? null, timings: response.timings,
        passed, slow: (response.timings?.ttfbMs ?? 0) > slowThresholdMs })
    }
  }
  const status = dns.ips.length === 0 || requests.some((request) => !request.passed)
    ? 'failed' : requests.some((request) => request.slow) ? 'slow' : 'passed'
  return { schemaVersion: 1, checkedAt, host: 'fit-training.ru', network, slowThresholdMs,
    status, dns: { dnsMs: dns.dnsMs, ips: dns.ips, error: dns.error ?? null }, requests,
    note: 'One probe network, not all user networks. /healthz does not verify Object Storage.' }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await probeFrontendGatewayWarmup()
  console.log(`Frontend gateway warmup: ${report.status}; ${report.checkedAt}; IPs=${report.dns.ips.length}`)
  for (const item of report.requests) {
    console.log(`${item.startedAt} ${item.ip} ${item.resource} HTTP ${item.status ?? '-'} `
      + `ttfb=${item.timings?.ttfbMs ?? '-'}ms total=${item.timings?.totalMs ?? '-'}ms `
      + `passed=${item.passed} slow=${item.slow} ${item.error ?? ''}`)
  }
  if (report.status === 'failed') process.exitCode = 1
}
