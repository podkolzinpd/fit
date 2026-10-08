import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { SMOKE_BUDGET_MS, runSmokeRequest, safeRequestMetadata, verifyFixtureBudget } from './yandex-stage-smoke.mjs'

const nowMs = Date.parse('2026-10-08T10:59:00Z')
const deadlineMs = nowMs + SMOKE_BUDGET_MS
const token = 'x'.repeat(43)
const clientId = '11111111-1111-4111-8111-111111111111'
function fixture(issuedAt = nowMs) {
  const session = { token, expiresAt: new Date(issuedAt + 900_000).toISOString() }
  return { status: 'fixture_ready', seededTrainerCount: 1,
    session: { ...session, clientId }, clientSession: { ...session },
    mediaSession: { ...session }, trainerProfileSession: { ...session } }
}

test('accepts fresh short-lived synthetic sessions without changing their TTL', () => {
  assert.doesNotThrow(() => verifyFixtureBudget(fixture(), deadlineMs, nowMs))
})

test('rejects pre-deployment sessions when deployment consumed their test budget', () => {
  const smokeStart = nowMs + 400_000
  assert.throws(() => verifyFixtureBudget(fixture(), smokeStart + SMOKE_BUDGET_MS, smokeStart),
    /insufficient_fixture_session_lifetime/u)
  assert.doesNotThrow(() => verifyFixtureBudget(fixture(smokeStart), smokeStart + SMOKE_BUDGET_MS, smokeStart))
})

for (const name of ['session', 'clientSession', 'mediaSession', 'trainerProfileSession']) {
  test(`checks expiry and token of ${name}, not only the trainer session`, () => {
    const expired = fixture()
    expired[name].expiresAt = new Date(nowMs - 1).toISOString()
    assert.throws(() => verifyFixtureBudget(expired, deadlineMs, nowMs), /insufficient_fixture_session_lifetime/u)
    const invalid = fixture()
    invalid[name].token = 'invalid'
    assert.throws(() => verifyFixtureBudget(invalid, deadlineMs, nowMs), /insufficient_fixture_session_lifetime/u)
    invalid[name].token = token
    invalid[name].expiresAt = 'not-a-date'
    assert.throws(() => verifyFixtureBudget(invalid, deadlineMs, nowMs), /insufficient_fixture_session_lifetime/u)
  })
}

test('fails closed on invalid fixture response or an unbounded/expired budget', () => {
  for (const invalid of [null, {}, { ...fixture(), status: 'error' },
    { ...fixture(), seededTrainerCount: 0 }, { ...fixture(), session: { token } }]) {
    assert.throws(() => verifyFixtureBudget(invalid, deadlineMs, nowMs), /invalid_smoke_fixture/u)
  }
  for (const invalid of [NaN, nowMs, nowMs - 1, deadlineMs + 1]) {
    assert.throws(() => verifyFixtureBudget(fixture(), invalid, nowMs), /invalid_smoke_budget/u)
  }
})

test('bounds each request and overrides broad retries without changing curl output', () => {
  const stdout = Buffer.from('{"status":"ok"}')
  let calls = 0
  const result = runSmokeRequest(['--retry', '8', '--retry-all-errors', '--max-time', '999',
    '--dump-header', 'headers', 'https://stage.invalid/v1/workouts'], {
    deadlineMs, nowMs, read: () => 'HTTP/1.1 200 OK\r\n',
    execute(command, args, options) {
      calls += 1
      assert.equal(command, 'curl')
      assert.deepEqual(args.slice(-6), ['--connect-timeout', '5', '--max-time', '30', '--retry', '0'])
      assert.equal(options.timeout, 30_000)
      return { status: 0, stdout }
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 0)
  assert.equal(result.stdout, stdout)
})

test('shares the same deadline across requests and clamps the final request', () => {
  for (const remaining of [1200, 250]) {
    runSmokeRequest([], { deadlineMs, nowMs: deadlineMs - remaining, read: () => '',
      execute(_command, args, options) {
        assert.equal(options.timeout, remaining)
        assert.equal(args.at(-3), String(remaining / 1000))
        return { status: 0, stdout: Buffer.alloc(0) }
      } })
  }
  const result = runSmokeRequest([], { deadlineMs, nowMs: deadlineMs,
    execute() { assert.fail('must not send a request after the suite deadline') } })
  assert.equal(result.status, 124)
  assert.equal(result.metadata.code, 'smoke_budget_exhausted')
})

test('reports a transport timeout without leaking the curl error message', () => {
  for (const response of [{ status: null, error: { code: 'ETIMEDOUT', message: 'sensitive' } },
    { status: 28, stderr: 'sensitive' }]) {
    const result = runSmokeRequest([], { deadlineMs, nowMs, read: () => '', execute: () => response })
    assert.equal(result.metadata.code, 'request_timeout')
    assert.doesNotMatch(JSON.stringify(result), /sensitive/u)
  }
})

test('distinguishes HTTP 401 from a platform failure and does not retry mutations', () => {
  let calls = 0
  const result = runSmokeRequest(['--request', 'POST', '--data', '{}',
    '--output', 'response', '--dump-header', 'headers', 'https://stage.invalid/v1/workouts'], {
    deadlineMs, nowMs,
    read: (path) => path === 'headers' ? 'HTTP/1.1 401 Unauthorized\r\n' : '{"error":"unauthorized"}',
    execute() { calls += 1; return { status: 0, stdout: Buffer.from('401') } },
  })
  assert.equal(calls, 1)
  assert.equal(result.stdout.toString(), '401')
  assert.equal(result.metadata.http, '401')
  assert.equal(result.metadata.category, 'authentication')
  assert.equal(result.metadata.code, 'unauthorized')
  assert.equal(result.metadata.method, 'POST')
})

test('preserves expected 409 responses rather than converting them to transport errors', () => {
  const result = runSmokeRequest(['--request', 'PUT', '--dump-header', 'headers'], {
    deadlineMs, nowMs, read: () => 'HTTP/1.1 409 Conflict\r\n',
    execute: () => ({ status: 0, stdout: Buffer.from('409') }),
  })
  assert.equal(result.status, 0)
  assert.equal(result.metadata.http, '409')
})

test('does not use a stale response body when curl failed', () => {
  const result = runSmokeRequest(['--output', 'body', '--dump-header', 'headers'], {
    deadlineMs, nowMs,
    read: (path) => path === 'headers' ? 'HTTP/1.1 503 Failed\r\n' : '{"error":"unauthorized"}',
    execute: () => ({ status: 22 }),
  })
  assert.equal(result.status, 22)
  assert.equal(result.metadata.http, '503')
  assert.equal(result.metadata.code, 'unknown')
})

test('only records the final HTTP block and validated safe diagnostic fields', () => {
  const release = 'a'.repeat(40)
  const metadata = safeRequestMetadata(['--request', 'DELETE',
    `https://stage.invalid/v1/workouts/${clientId}?token=private`],
  `HTTP/1.1 502 Bad Gateway\r\nx-fit-error-code: OLD_CODE\r\n\r\nHTTP/1.1 401 Unauthorized\r\nx-fit-request-id: ${clientId}\r\nx-fit-release-id: ${release}\r\n`,
  '{"error":"unauthorized","token":"private"}', 0)
  assert.equal(metadata.http, '401')
  assert.equal(metadata.code, 'unauthorized')
  assert.equal(metadata.release, release)
  assert.equal(metadata.requestId, clientId)
  assert.equal(metadata.route, '/v1/workouts/…')
  assert.doesNotMatch(JSON.stringify(metadata), /private|OLD_CODE|stage.invalid/u)
})

test('does not persist arbitrary error text, unsafe headers, or signed object URLs', () => {
  const metadata = safeRequestMetadata(['https://objects.invalid/private/path?signature=private'],
    'HTTP/1.1 503 Failed\r\nx-fit-error-category: private\r\nx-fit-error-code: private\r\nx-fit-request-id: private\r\nx-fit-release-id: private\r\n',
    '{"error":"private","details":"private"}', 0)
  assert.equal(metadata.route, 'external-object')
  assert.equal(metadata.code, 'unknown')
  assert.doesNotMatch(JSON.stringify(metadata), /private|signature|objects.invalid/u)
})

test('real curl/CLI preserves a 401 body and status, emits safe diagnostics and sends POST once', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fit-smoke-contract-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let calls = 0
  const server = createServer((request, response) => {
    calls += 1
    assert.equal(request.method, 'POST')
    response.writeHead(401, { 'content-type': 'application/json', 'x-fit-release-id': 'a'.repeat(40) })
    response.end('{"error":"unauthorized","details":"not-for-logs"}')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const metadataFile = join(directory, 'metadata.json')
  const env = { ...process.env, FIT_STAGE_SMOKE_DEADLINE_MS: String(Date.now() + SMOKE_BUDGET_MS),
    FIT_STAGE_SMOKE_METADATA: metadataFile, API_IMAGE_TAG: 'a'.repeat(40) }
  const helper = join(import.meta.dirname, 'yandex-stage-smoke.mjs')
  const run = promisify(execFile)
  const { stdout } = await run(process.execPath, [helper, 'request', '--silent', '--show-error',
    '--request', 'POST', '--data', '{}', '--retry', '8', '--retry-all-errors', '--retry-delay', '2',
    '--dump-header', join(directory, 'headers'), '--output', join(directory, 'body'),
    '--write-out', '%{http_code}', `http://127.0.0.1:${server.address().port}/v1/workouts`],
  { env, timeout: 5000 })
  assert.equal(stdout, '401')
  assert.equal(calls, 1)
  assert.equal(JSON.parse(await readFile(join(directory, 'body'), 'utf8')).error, 'unauthorized')
  const { stderr } = await run(process.execPath, [helper, 'report', 'planned-workout-create', '1'], { env, timeout: 5000 })
  assert.match(stderr, /check=planned-workout-create; method=POST; route=\/v1\/workouts; HTTP=401/u)
  assert.match(stderr, /category=authentication; code=unauthorized/u)
  assert.doesNotMatch(stderr, /not-for-logs|127\.0\.0\.1/u)
  assert.doesNotMatch(await readFile(metadataFile, 'utf8'), /not-for-logs|127\.0\.0\.1/u)
  await assert.rejects(run(process.execPath, [helper, 'request', '--fail', '--silent',
    '--request', 'POST', '--data', '{}', '--retry', '8', '--retry-all-errors', '--retry-delay', '2',
    '--dump-header', join(directory, 'headers'),
    `http://127.0.0.1:${server.address().port}/v1/workouts`], { env, timeout: 5000 }),
  (error) => error.code === 22 && error.stderr.includes('exit=22'))
  assert.equal(calls, 2, 'the second POST must not be retried either, even with --fail')
  const failedMetadata = JSON.parse(await readFile(metadataFile, 'utf8'))
  assert.equal(failedMetadata.http, '401')
  assert.equal(failedMetadata.code, 'unauthorized')
})
