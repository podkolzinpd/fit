import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const SMOKE_BUDGET_MS = 600_000
const SESSION_MARGIN_MS = 60_000
const REQUEST_TIMEOUT_MS = 30_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const ERROR_CODES = new Set([
  'unauthorized', 'action_not_allowed', 'service_unavailable',
  'resource_not_found', 'version_conflict', 'invalid_request',
])

export function verifyFixtureBudget(fixture, deadlineMs, nowMs = Date.now()) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= nowMs
    || deadlineMs - nowMs > SMOKE_BUDGET_MS) {
    throw new Error('invalid_smoke_budget')
  }
  if (fixture?.status !== 'fixture_ready'
    || !Number.isInteger(fixture.seededTrainerCount) || fixture.seededTrainerCount < 1
    || !UUID.test(fixture.session?.clientId ?? '')) {
    throw new Error('invalid_smoke_fixture')
  }
  for (const key of ['session', 'clientSession', 'mediaSession', 'trainerProfileSession']) {
    const session = fixture[key]
    if (!/^[A-Za-z0-9_-]{43}$/u.test(session?.token ?? '')
      || typeof session?.expiresAt !== 'string'
      || !Number.isFinite(Date.parse(session.expiresAt))
      || Date.parse(session.expiresAt) < deadlineMs + SESSION_MARGIN_MS) {
      throw new Error('insufficient_fixture_session_lifetime')
    }
  }
}

function lastOption(args, flag) {
  let value
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === flag) value = args[index + 1]
  }
  return value
}

function readText(path) {
  try { return readFileSync(path, 'utf8') } catch { return '' }
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

function safeRoute(args) {
  // Never persist a query, signed object URL, entity ID, or arbitrary path.
  const url = args.findLast((arg) => /^https?:\/\//u.test(arg))
  try {
    const path = new URL(url).pathname
    const root = path.match(/^\/v1\/(clients|connections|training-data|trainer-profile|workouts|custom-exercises)(?:\/|$)/u)?.[0]
    return root ? `${root.replace(/\/$/u, '')}${path === root ? '' : '/…'}` : 'external-object'
  } catch { return 'unknown' }
}

export function safeRequestMetadata(args, headerText, bodyText, exitCode) {
  // curl may record several HTTP blocks; only the final response is relevant.
  let headers = new Map()
  let http = '000'
  for (const line of headerText.split(/\r?\n/u)) {
    const status = line.match(/^HTTP\/\S+ (\d{3})/u)
    if (status) { headers = new Map(); http = status[1] }
    const separator = line.indexOf(':')
    if (separator > 0) headers.set(line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim())
  }
  const headerCode = headers.get('x-fit-error-code')
  const body = parseJson(bodyText)
  const bodyCode = typeof body?.error === 'string' ? body.error : body?.error?.code
  const category = headers.get('x-fit-error-category')
  const requestId = headers.get('x-fit-request-id')
  const release = headers.get('x-fit-release-id')
  const method = lastOption(args, '--request') ?? (args.includes('--data') ? 'POST' : 'GET')
  return {
    method: /^(GET|POST|PUT|PATCH|DELETE|HEAD)$/u.test(method) ? method : 'unknown',
    route: safeRoute(args), http, commandExit: exitCode,
    requestId: UUID.test(requestId ?? '') ? requestId : 'unknown',
    category: ['authentication', 'permission', 'network', 'tls', 'unknown'].includes(category)
      ? category : http === '401' ? 'authentication' : 'unclassified',
    code: /^[A-Z0-9_]{2,64}$/u.test(headerCode ?? '') ? headerCode
      : ERROR_CODES.has(bodyCode) ? bodyCode : http === '401' ? 'unauthorized' : 'unknown',
    release: /^[0-9a-f]{40}$/u.test(release ?? '') ? release : 'unknown',
  }
}

export function runSmokeRequest(args, {
  deadlineMs, nowMs = Date.now(), execute = spawnSync, read = readText,
} = {}) {
  const remainingMs = deadlineMs - nowMs
  if (!Number.isSafeInteger(deadlineMs) || remainingMs <= 0) {
    return { status: 124, stdout: Buffer.alloc(0), metadata: {
      ...safeRequestMetadata(args, '', '', 124), code: 'smoke_budget_exhausted',
    } }
  }
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, remainingMs)
  // Last options override legacy per-call retries. No mutation or HTTP 401 is retried.
  const result = execute('curl', [...args,
    '--connect-timeout', '5', '--max-time', String(timeoutMs / 1000), '--retry', '0',
  ], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
  const status = result.error?.code === 'ETIMEDOUT' ? 124 : result.status ?? 1
  const headerPath = lastOption(args, '--dump-header')
  const bodyPath = lastOption(args, '--output')
  // --fail/network errors may leave an old output file: do not diagnose it as
  // the current response. Safe headers still identify HTTP 401 without a body.
  const bodyText = status === 0
    ? bodyPath ? read(bodyPath) : result.stdout?.toString('utf8') ?? '' : ''
  const metadata = safeRequestMetadata(args, read(headerPath), bodyText, status)
  if (status === 124 || status === 28) metadata.code = 'request_timeout'
  return { status, stdout: result.stdout ?? Buffer.alloc(0), metadata }
}

function main() {
  const [operation, ...args] = process.argv.slice(2)
  const deadlineMs = Number(process.env.FIT_STAGE_SMOKE_DEADLINE_MS)
  if (operation === 'verify-fixture') {
    verifyFixtureBudget(JSON.parse(readFileSync(args[0], 'utf8')), deadlineMs)
  } else if (operation === 'request') {
    const result = runSmokeRequest(args, { deadlineMs })
    writeFileSync(process.env.FIT_STAGE_SMOKE_METADATA, JSON.stringify(result.metadata), { mode: 0o600 })
    process.stdout.write(result.stdout)
    if (result.status !== 0) console.error(`Stage smoke transport failed: ${result.metadata.code}; exit=${result.status}.`)
    process.exitCode = result.status
  } else if (operation === 'report') {
    const meta = parseJson(readText(process.env.FIT_STAGE_SMOKE_METADATA)) ?? {}
    const check = /^[a-z0-9-]+$/u.test(args[0] ?? '') ? args[0] : 'unknown'
    const expected = /^[0-9a-f]{40}$/u.test(process.env.API_IMAGE_TAG ?? '') ? process.env.API_IMAGE_TAG : 'unknown'
    console.error(`Stage smoke failed: check=${check}; method=${meta.method ?? 'unknown'}; route=${meta.route ?? 'unknown'}; HTTP=${meta.http ?? '000'}; command_exit=${Number(args[1]) || 1}; request_id=${meta.requestId ?? 'unknown'}; category=${meta.category ?? 'unclassified'}; code=${meta.code ?? 'unknown'}; release=${meta.release ?? 'unknown'}; expected_release=${expected}.`)
  } else if (operation === 'verify-deadline') {
    if (!Number.isSafeInteger(deadlineMs) || Date.now() >= deadlineMs) throw new Error('smoke_budget_exhausted')
  } else {
    throw new Error('invalid_smoke_operation')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main() } catch (error) {
    const code = ['invalid_smoke_budget', 'invalid_smoke_fixture',
      'insufficient_fixture_session_lifetime', 'smoke_budget_exhausted',
      'invalid_smoke_operation'].includes(error.message) ? error.message : 'smoke_configuration_error'
    console.error(`Stage smoke stopped: ${code}.`)
    process.exitCode = 1
  }
}
