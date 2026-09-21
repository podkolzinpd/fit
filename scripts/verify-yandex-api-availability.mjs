import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function nonNegativeInteger(value, name) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return number
}

function positiveInteger(value, name) {
  const number = nonNegativeInteger(value, name)
  if (number === 0) throw new Error(`${name} must be positive`)
  return number
}

function parseJson(text) {
  try {
    return text === '' ? null : JSON.parse(text)
  } catch {
    return null
  }
}

function safeHeader(response, name) {
  return response?.headers?.get?.(name) ?? null
}

function classifyHttpFailure(response) {
  return safeHeader(response, 'x-fit-request-id') ? 'application' : 'platform'
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function verifyYandexApiAvailability({
  url,
  expectedReleaseId,
  count,
  intervalMs = 0,
  timeoutMs = 12_000,
  authorizationToken,
  fetch_ = globalThis.fetch,
  sleep = defaultSleep,
  onProgress = () => {},
  now = () => new Date(),
}) {
  const baseUrl = requiredString(url, 'url').replace(/\/$/u, '')
  const releaseId = requiredString(expectedReleaseId, 'expected release ID')
  const requestedProbes = positiveInteger(count, 'probe count')
  const delayMs = nonNegativeInteger(intervalMs, 'probe interval')
  const requestTimeoutMs = positiveInteger(timeoutMs, 'request timeout')
  if (typeof fetch_ !== 'function') throw new Error('fetch is unavailable')

  const startedAt = now().toISOString()
  const headers = authorizationToken
    ? { Authorization: `Bearer ${authorizationToken}` }
    : {}
  let successfulProbes = 0
  let firstFailure = null

  for (let probe = 1; probe <= requestedProbes; probe += 1) {
    let response
    try {
      response = await fetch_(`${baseUrl}/health`, {
        headers,
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
    } catch {
      firstFailure = {
        probe,
        category: 'platform',
        httpStatus: 0,
        platformRequestId: null,
        fitRequestId: null,
        reason: 'network_or_timeout',
      }
      break
    }

    const body = parseJson(await response.text())
    const platformRequestId = safeHeader(response, 'x-request-id')
      ?? safeHeader(response, 'x-server-trace-id')
    const fitRequestId = safeHeader(response, 'x-fit-request-id')
    const healthyCandidate = response.status === 200
      && body?.status === 'ok'
      && body?.releaseId === releaseId

    if (!healthyCandidate) {
      firstFailure = {
        probe,
        category: response.status === 200
          ? 'application'
          : classifyHttpFailure(response),
        httpStatus: response.status,
        platformRequestId,
        fitRequestId,
        reason: response.status === 200
          ? 'unexpected_health_contract'
          : 'http_error',
      }
      break
    }

    successfulProbes += 1
    if (probe === 1 || probe === requestedProbes || probe % 100 === 0) {
      onProgress({ probe, requestedProbes })
    }
    if (probe < requestedProbes && delayMs > 0) await sleep(delayMs)
  }

  return {
    status: firstFailure == null ? 'passed' : 'failed',
    requestedProbes,
    completedProbes: successfulProbes + (firstFailure == null ? 0 : 1),
    successfulProbes,
    intervalMs: delayMs,
    startedAt,
    completedAt: now().toISOString(),
    failureCategory: firstFailure?.category ?? null,
    firstFailure,
  }
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value == null) {
      throw new Error(`invalid argument near ${name ?? 'end of command'}`)
    }
    values.set(name.slice(2), value)
  }
  return {
    url: values.get('url'),
    expectedReleaseId: values.get('expected-release-id'),
    count: values.get('count'),
    intervalMs: values.get('interval-ms') ?? 0,
    timeoutMs: values.get('timeout-ms') ?? 12_000,
    reportPath: values.get('report') ?? 'yandex-api-availability.json',
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const report = await verifyYandexApiAvailability({
    ...options,
    authorizationToken: process.env.YC_TOKEN,
    onProgress: ({ probe, requestedProbes }) => {
      process.stdout.write(`Availability probe ${probe}/${requestedProbes} passed.\n`)
    },
  })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  })

  if (report.status === 'passed') {
    process.stdout.write(
      `Availability verification passed: ${report.successfulProbes}/`
        + `${report.requestedProbes} sequential requests, no retries.\n`,
    )
    return
  }

  const failure = report.firstFailure
  process.stderr.write(
    `Availability probe ${failure.probe}/${report.requestedProbes} failed: `
      + `category=${failure.category}; HTTP=${failure.httpStatus}; `
      + `platform_request_id=${failure.platformRequestId ?? 'missing'}; `
      + `fit_request_id=${failure.fitRequestId ?? 'missing'}.\n`,
  )
  process.exitCode = 1
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
