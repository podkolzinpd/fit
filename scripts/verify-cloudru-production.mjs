import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

const expectedAddress = '87.242.117.210'
const hosts = ['fit-training.ru', 'www.fit-training.ru', 'api.fit-training.ru']

// No response bodies, cookies, arbitrary URLs or transport error messages are
// exported. The only body field retained is the public API release identifier.
export function probeProduction(host, path) {
  if (!hosts.includes(host) || !['/auth', '/health', '/ready', '/v1/clients'].includes(path)) {
    throw new Error('Unsupported production probe')
  }
  return new Promise(done => {
    let complete = false
    const finish = value => {
      if (complete) return
      complete = true
      clearTimeout(deadline)
      done(value)
    }
    const req = request({ hostname: host, path, method: 'GET', agent: false,
      timeout: 10_000, rejectUnauthorized: true }, response => {
      const certificate = response.socket.getPeerCertificate()
      const expiresAt = Date.parse(certificate.valid_to)
      const chunks = []
      let size = 0
      response.on('data', chunk => {
        size += chunk.length
        if (size > 1_000_000) req.destroy()
        else if (path === '/health') chunks.push(chunk)
      })
      response.on('end', () => {
        let release
        if (path === '/health') {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (/^[a-f0-9]{40}$/.test(value.releaseId)) release = value.releaseId
          } catch { /* Invalid health payload fails the release check below. */ }
        }
        finish({ status: response.statusCode, certificateValidDays:
          Number.isFinite(expiresAt) ? Math.floor((expiresAt - Date.now()) / 86_400_000) : 0,
        ...(release ? { release } : {}) })
      })
      response.on('error', () => finish({ error: 'response_failed' }))
    })
    const deadline = setTimeout(() => req.destroy(), 12_000)
    req.on('timeout', () => req.destroy())
    req.on('error', () => finish({ error: 'request_failed' }))
    req.end()
  })
}

export async function verifyCloudruProduction({ resolveHost = host => lookup(host, { all: true }),
  probe = probeProduction, expectedRelease } = {}) {
  if (expectedRelease !== undefined && !/^[a-f0-9]{40}$/.test(expectedRelease)) {
    throw new Error('Invalid expected release')
  }
  const dns = await Promise.all(hosts.map(async host => {
    try {
      const addresses = [...new Set((await resolveHost(host)).map(entry => entry.address))].sort()
      return { host, addresses, passed: addresses.length === 1 && addresses[0] === expectedAddress }
    } catch { return { host, addresses: [], passed: false } }
  }))
  const cases = [
    ['fit-training.ru', '/auth', 200], ['www.fit-training.ru', '/auth', 200],
    ['api.fit-training.ru', '/health', 200], ['api.fit-training.ru', '/ready', 200],
    ['api.fit-training.ru', '/v1/clients', 401],
  ]
  const checks = await Promise.all(cases.map(async ([host, path, expectedStatus]) => {
    const result = await probe(host, path)
    const releasePassed = path !== '/health' ||
      (/^[a-f0-9]{40}$/.test(result.release ?? '') && (!expectedRelease || result.release === expectedRelease))
    return { host, path, ...result, passed: result.status === expectedStatus
      && result.certificateValidDays >= 14 && releasePassed }
  }))
  return { checkedAt: new Date().toISOString(), status:
    [...dns, ...checks].every(check => check.passed) ? 'passed' : 'failed', dns, checks }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyCloudruProduction({ expectedRelease: process.env.EXPECTED_API_RELEASE })
  await writeFile('cloudru-production-health.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
  if (report.status !== 'passed') process.exitCode = 1
}
