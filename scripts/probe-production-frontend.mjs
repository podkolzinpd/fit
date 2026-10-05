import { Resolver, lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const host = 'fit-training.ru'
const maxBodyBytes = 1_000_000
const slowThresholdMs = 5_000
const resolvers = [
  { name: 'system' },
  { name: 'yandex', server: '77.88.8.8' },
  { name: 'cloudflare', server: '1.1.1.1' },
  { name: 'google', server: '8.8.8.8' },
]

function safeError(error) {
  const code = error && typeof error === 'object' ? error.code : null
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,30}$/.test(code) ? code : 'NETWORK_ERROR'
}

export async function resolveFrontendAddresses(source) {
  const started = performance.now()
  try {
    let addresses
    if (source.server || source.useResolver) {
      const resolver = new Resolver({ timeout: 2_000, tries: 1 })
      if (source.server) resolver.setServers([source.server])
      addresses = (await resolver.resolve4(host)).map((address) => ({ address }))
    } else {
      addresses = await lookup(host, { all: true, family: 4 })
    }
    return { name: source.name, dnsMs: Math.round(performance.now() - started),
      ips: [...new Set(addresses.map((address) => address.address))].sort() }
  } catch (error) {
    return { name: source.name, dnsMs: Math.round(performance.now() - started),
      ips: [], error: safeError(error) }
  }
}

export function extractCriticalAssets(html) {
  return [...new Set([...html.matchAll(/["'](\/assets\/[^"'?#]+\.(?:js|css))["']/g)]
    .map((match) => match[1]))].slice(0, 2)
}

export function measureFrontendRequest(ip, path, { method = 'GET', timeoutMs = 12_000, requestImpl = request } = {}) {
  return new Promise((done) => {
    const started = performance.now()
    const timings = { tcpMs: null, tlsMs: null, ttfbMs: null, downloadMs: null, totalMs: null }
    let connectedAt = null
    let secureAt = null
    let responseAt = null
    let settled = false
    let deadline
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      timings.totalMs = Math.round(performance.now() - started)
      done({ ...result, timings })
    }
    const req = requestImpl({ hostname: ip, port: 443, path, method, servername: host,
      headers: { Host: host, 'User-Agent': 'fit-frontend-network-probe/1.0' }, agent: false,
      timeout: timeoutMs, rejectUnauthorized: true }, (response) => {
      responseAt = performance.now()
      timings.ttfbMs = Math.round(responseAt - (secureAt ?? started))
      let bytes = 0
      const chunks = []
      response.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > maxBodyBytes) {
          req.destroy(Object.assign(new Error('response too large'), { code: 'RESPONSE_TOO_LARGE' }))
          return
        }
        if (method === 'GET') chunks.push(chunk)
      })
      response.on('end', () => {
        timings.downloadMs = Math.round(performance.now() - responseAt)
        finish({ status: response.statusCode ?? null,
          contentType: String(response.headers['content-type'] ?? '').split(';')[0],
          body: method === 'GET' ? Buffer.concat(chunks).toString('utf8') : '' })
      })
      response.on('error', (error) => finish({ status: response.statusCode ?? null, error: safeError(error) }))
    })
    req.on('socket', (socket) => {
      socket.on('connect', () => {
        connectedAt = performance.now()
        timings.tcpMs = Math.round(connectedAt - started)
      })
      socket.on('secureConnect', () => {
        secureAt = performance.now()
        timings.tlsMs = Math.round(secureAt - (connectedAt ?? started))
      })
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    req.on('error', (error) => finish({ status: null, error: safeError(error) }))
    // An inactivity timeout alone can be kept alive by a trickling response.
    deadline = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), timeoutMs)
    req.end()
  })
}

export async function probeProductionFrontend({
  sources = resolvers,
  resolveAddresses = resolveFrontendAddresses,
  measure = measureFrontendRequest,
} = {}) {
  const checkedAt = new Date().toISOString()
  const dns = []
  const requests = []
  let html = null
  let firstWorkingIp = null
  for (const source of sources) {
    const result = await resolveAddresses(source)
    dns.push(result)
    for (const ip of result.ips) {
      const startedAt = new Date().toISOString()
      const response = await measure(ip, '/auth')
      const passed = response.status === 200 && response.contentType === 'text/html'
        && response.body?.includes('<title>Fit</title>') === true
      requests.push({ startedAt, resolver: source.name, ip, resource: 'html', status: response.status,
        timings: response.timings, error: response.error ?? null, passed,
        slow: result.dnsMs + (response.timings?.totalMs ?? 0) > slowThresholdMs })
      if (passed && !html) { html = response.body; firstWorkingIp = ip }
    }
  }
  const assets = html ? extractCriticalAssets(html) : []
  for (const path of assets) {
    const startedAt = new Date().toISOString()
    const response = await measure(firstWorkingIp, path, { method: 'HEAD' })
    const type = path.endsWith('.css') ? 'css' : 'js'
    requests.push({ startedAt, resolver: 'first-working-ip', ip: firstWorkingIp, resource: type,
      status: response.status, timings: response.timings, error: response.error ?? null,
      passed: response.status === 200, slow: (response.timings?.totalMs ?? 0) > slowThresholdMs })
  }
  const systemDns = dns.find((result) => result.name === 'system')
  const status = !systemDns?.ips.length || requests.some((result) => !result.passed || result.slow)
    || assets.length === 0 ? 'failed' : 'passed'
  return { schemaVersion: 1, checkedAt, host, slowThresholdMs, status, dns, requests,
    note: 'All probes run from one network. Different resolvers do not represent different client networks.' }
}

async function main() {
  const reportIndex = process.argv.indexOf('--report')
  const reportPath = reportIndex === -1 ? null : process.argv[reportIndex + 1]
  if (reportIndex !== -1 && !reportPath) throw new Error('--report requires a path')
  const report = await probeProductionFrontend()
  if (reportPath) await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Frontend network probe: ${report.status}; DNS sources=${report.dns.length}; HTTPS requests=${report.requests.length}`)
  for (const result of report.requests) {
    console.log(`${result.passed && !result.slow ? 'PASS' : 'FAIL'} ${result.startedAt} ${result.resolver} ${result.ip} ${result.resource} HTTP ${result.status ?? '-'} `
      + `tcp=${result.timings?.tcpMs ?? '-'}ms tls=${result.timings?.tlsMs ?? '-'}ms `
      + `ttfb=${result.timings?.ttfbMs ?? '-'}ms total=${result.timings?.totalMs ?? '-'}ms ${result.error ?? ''}`)
  }
  if (report.status !== 'passed') process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
