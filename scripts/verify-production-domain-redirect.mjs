import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LEGACY_PRODUCTION_ORIGIN = 'https://fit-drab.vercel.app'
export const CANONICAL_PRODUCTION_ORIGIN = 'https://fit-training.ru'

export const redirectChecks = [
  '/',
  '/auth',
  '/client',
  '/invite?source=legacy&code=redirect-monitor',
]

function normalizedLocation(value) {
  return value.endsWith('/') ? value : value.replace(/\/$/, '')
}

export async function verifyProductionDomainRedirect({
  fetchImpl = fetch,
  legacyOrigin = LEGACY_PRODUCTION_ORIGIN,
  canonicalOrigin = CANONICAL_PRODUCTION_ORIGIN,
  timeoutMs = 12_000,
} = {}) {
  const results = []

  for (const path of redirectChecks) {
    const source = new URL(path, legacyOrigin).href
    const expectedLocation = new URL(path, canonicalOrigin).href
    try {
      const response = await fetchImpl(source, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'fit-production-domain-monitor/1.0' },
      })
      const actualLocation = response.headers.get('location')
      const passed = response.status === 308
        && actualLocation !== null
        && normalizedLocation(actualLocation) === normalizedLocation(expectedLocation)
      results.push({
        source,
        expectedLocation,
        actualLocation,
        status: response.status,
        passed,
      })
    } catch (error) {
      results.push({
        source,
        expectedLocation,
        actualLocation: null,
        status: null,
        passed: false,
        error: error instanceof Error ? error.name : 'UnknownError',
      })
    }
  }

  const canonicalUrl = new URL('/auth', canonicalOrigin).href
  try {
    const response = await fetchImpl(canonicalUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'fit-production-domain-monitor/1.0' },
    })
    const finalUrl = new URL(response.url || canonicalUrl)
    results.push({
      source: canonicalUrl,
      expectedLocation: canonicalUrl,
      actualLocation: finalUrl.href,
      status: response.status,
      passed: response.status === 200 && finalUrl.origin === new URL(canonicalOrigin).origin,
    })
  } catch (error) {
    results.push({
      source: canonicalUrl,
      expectedLocation: canonicalUrl,
      actualLocation: null,
      status: null,
      passed: false,
      error: error instanceof Error ? error.name : 'UnknownError',
    })
  }

  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    legacyOrigin,
    canonicalOrigin,
    status: results.every((result) => result.passed) ? 'passed' : 'failed',
    results,
  }
}

async function main() {
  const reportIndex = process.argv.indexOf('--report')
  const reportPath = reportIndex === -1 ? null : process.argv[reportIndex + 1]
  if (reportIndex !== -1 && !reportPath) throw new Error('--report requires a path')

  const report = await verifyProductionDomainRedirect()
  if (reportPath) await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, { flag: 'w' })
  for (const result of report.results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.source} -> ${result.actualLocation ?? 'unavailable'} (${result.status ?? 'network error'})`)
  }
  if (report.status !== 'passed') process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
