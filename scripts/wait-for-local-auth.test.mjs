import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readConfig, waitForLocalAuth } from './wait-for-local-auth.mjs'

const baseEnv = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('reads local auth readiness defaults from CI env', () => {
  const config = readConfig(baseEnv)

  assert.equal(config.endpoint, 'http://127.0.0.1:54321/auth/v1/token?grant_type=password')
  assert.equal(config.publishableKey, 'test-publishable-key')
  assert.equal(config.email, 'trainer@fit.local')
  assert.equal(config.password, 'FitLocal123!')
  assert.equal(config.attempts, 30)
  assert.equal(config.intervalMs, 1_000)
  assert.equal(config.timeoutMs, 5_000)
})

test('rejects missing publishable key before making a request', () => {
  assert.throws(
    () => readConfig({ VITE_SUPABASE_URL: baseEnv.VITE_SUPABASE_URL }),
    /VITE_SUPABASE_PUBLISHABLE_KEY is required/,
  )
})

test('retries transient upstream auth failures until the seeded login works', async () => {
  const statuses = [502, 503, 200]
  const requests = []

  await waitForLocalAuth(
    { ...readConfig(baseEnv), attempts: statuses.length, intervalMs: 1 },
    {
      sleep: async () => {},
      fetch: async (url, init) => {
        requests.push({ url, init })
        const status = statuses.shift()
        if (status === 200) return jsonResponse(200, { access_token: 'token' })
        return jsonResponse(status, { message: 'upstream is not ready yet' })
      },
    },
  )

  assert.equal(requests.length, 3)
  assert.equal(requests[0].url, 'http://127.0.0.1:54321/auth/v1/token?grant_type=password')
  assert.equal(requests[0].init.headers.apikey, 'test-publishable-key')
  assert.equal(requests[0].init.body, JSON.stringify({ email: 'trainer@fit.local', password: 'FitLocal123!' }))
})

test('fails fast when auth is reachable but seeded credentials are wrong', async () => {
  await assert.rejects(
    waitForLocalAuth(
      { ...readConfig(baseEnv), attempts: 5, intervalMs: 1 },
      {
        sleep: async () => {
          throw new Error('non-retryable responses must not sleep')
        },
        fetch: async () => jsonResponse(400, { message: 'Invalid login credentials' }),
      },
    ),
    /Local Supabase Auth rejected the seeded test login: HTTP 400: Invalid login credentials/,
  )
})
