import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CANONICAL_PRODUCTION_ORIGIN,
  redirectChecks,
  verifyProductionDomainRedirect,
} from './verify-production-domain-redirect.mjs'

test('accepts only permanent path-preserving redirects and a healthy canonical auth route', async () => {
  const fetchImpl = async (url, init) => {
    if (init.redirect === 'follow') {
      return new Response('', { status: 200, headers: { 'content-type': 'text/html' } })
    }
    const parsed = new URL(url)
    return new Response('', {
      status: 308,
      headers: { location: `${CANONICAL_PRODUCTION_ORIGIN}${parsed.pathname}${parsed.search}` },
    })
  }
  const report = await verifyProductionDomainRedirect({ fetchImpl })
  assert.equal(report.status, 'passed')
  assert.equal(report.results.length, redirectChecks.length + 1)
  assert.equal(report.results.every((result) => result.passed), true)
})

test('fails when Vercel loses the query string or uses a temporary redirect', async () => {
  const fetchImpl = async (_url, init) => init.redirect === 'follow'
    ? new Response('', { status: 200 })
    : new Response('', {
      status: 307,
      headers: { location: `${CANONICAL_PRODUCTION_ORIGIN}/wrong` },
    })
  const report = await verifyProductionDomainRedirect({ fetchImpl })
  assert.equal(report.status, 'failed')
  assert.equal(report.results.slice(0, -1).every((result) => !result.passed), true)
})

test('records a safe error category without response bodies', async () => {
  const report = await verifyProductionDomainRedirect({
    fetchImpl: async () => { throw new TypeError('secret network detail') },
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.results.every((result) => result.error === 'TypeError'), true)
  assert.doesNotMatch(JSON.stringify(report), /secret network detail/)
})
