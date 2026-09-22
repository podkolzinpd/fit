import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const requestId = '3ea35ed0-4895-4893-b52a-98715ab1d5fa'
const otherId = '129c90e9-8f58-4c93-8160-19d72f25f1bc'

test('keeps incident diagnostics manual, read-only, bounded, and scoped to the API container', () => {
  const workflow = fs.readFileSync('.github/workflows/diagnose-yandex-stage.yml', 'utf8')

  assert.match(workflow, /^on:\n  workflow_dispatch:/m)
  assert.match(workflow, /^  id-token: write$/m)
  assert.match(workflow, /node scripts\/validate-yandex-incident-inputs\.mjs/)
  assert.match(workflow, /--name fit-stage-api/)
  assert.match(workflow, /serverless container revision list/)
  assert.match(workflow, /activeRevisionAtDiagnosis/)
  assert.match(workflow, /activeReleaseAtDiagnosis/)
  assert.match(workflow, /yc logging read default/)
  assert.match(workflow, /node scripts\/summarize-yandex-incident-logs\.mjs/)
  assert.doesNotMatch(workflow, /terraform (?:apply|destroy)|deploy-yandex-serverless-revision/)
})

test('accepts a bounded RFC-3339 incident window', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-yandex-incident-inputs.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      REQUEST_ID: requestId,
      SINCE_UTC: '2026-09-21T04:45:00Z',
      UNTIL_UTC: '2026-09-21T04:56:00Z',
      OPERATION: 'GET /v1/training-data',
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Validated a 660 second diagnostic window/)
})

test('rejects an operation containing query values', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-yandex-incident-inputs.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      REQUEST_ID: requestId,
      SINCE_UTC: '2026-09-21T04:45:00Z',
      UNTIL_UTC: '2026-09-21T04:56:00Z',
      OPERATION: 'GET /v1/training-data?user=secret',
    },
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /safe method and path without query values/)
})

test('rejects an incident window longer than 30 minutes', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-yandex-incident-inputs.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      REQUEST_ID: requestId,
      SINCE_UTC: '2026-09-21T04:00:00Z',
      UNTIL_UTC: '2026-09-21T04:31:00Z',
    },
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must not exceed 30 minutes/)
})

test('reports the requested correlation while redacting unrelated identifiers and credentials', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-yandex-incident-'))
  const logPath = path.join(directory, 'logs.json')
  const contextPath = path.join(directory, 'context.json')
  try {
    fs.writeFileSync(logPath, JSON.stringify([{
      timestamp: '2026-09-21T04:50:57.179Z',
      level: 'ERROR',
      message: `request ${requestId} failed for ${otherId} user@example.com Bearer secret-token`,
      jsonPayload: {
        reqId: requestId,
        req: { method: 'GET', url: '/v1/training-data?code=secret&state=secret' },
        res: { statusCode: 502 },
      },
    }]))
    fs.writeFileSync(contextPath, JSON.stringify({
      serviceName: 'fit-stage-api',
      resourceType: 'serverless_container',
      activeRevisionAtDiagnosis: 'bba-revision',
      activeReleaseAtDiagnosis: 'a'.repeat(40),
      operation: 'unknown',
    }))

    const result = spawnSync(process.execPath, [
      'scripts/summarize-yandex-incident-logs.mjs',
      logPath,
      requestId,
      contextPath,
    ], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.requestMatches.length, 1)
    assert.equal(summary.requestMatches[0].requestId, requestId)
    assert.equal(summary.requestMatches[0].path, '/v1/training-data')
    assert.equal(summary.requestMatches[0].statusCode, 502)
    assert.deepEqual(summary.diagnosticContext, {
      serviceName: 'fit-stage-api',
      resourceType: 'serverless_container',
      activeRevisionAtDiagnosis: 'bba-revision',
      activeReleaseAtDiagnosis: 'a'.repeat(40),
      operation: 'GET /v1/training-data',
      executionLayer: 'application',
      handler: 'entered',
    })
    assert.doesNotMatch(result.stdout, new RegExp(otherId))
    assert.doesNotMatch(result.stdout, /user@example\.com|secret-token|code=secret|state=secret/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('does not infer handler execution from a platform failure without application logs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-yandex-platform-'))
  const logPath = path.join(directory, 'logs.json')
  const contextPath = path.join(directory, 'context.json')
  try {
    fs.writeFileSync(logPath, JSON.stringify([{
      timestamp: '2026-09-21T18:15:02.362Z',
      message: `START RequestID: ${requestId}`,
    }, {
      timestamp: '2026-09-21T18:15:02.394Z',
      level: 'ERROR',
      message: `ERROR RequestID: ${requestId} Code: 502 Message: Error during function invocation`,
    }]))
    fs.writeFileSync(contextPath, JSON.stringify({
      serviceName: 'fit-stage-api',
      resourceType: 'serverless_container',
      activeRevisionAtDiagnosis: 'bba-revision',
      activeReleaseAtDiagnosis: 'b'.repeat(40),
      operation: 'GET /health',
    }))

    const result = spawnSync(process.execPath, [
      'scripts/summarize-yandex-incident-logs.mjs',
      logPath,
      requestId,
      contextPath,
    ], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.deepEqual(summary.diagnosticContext, {
      serviceName: 'fit-stage-api',
      resourceType: 'serverless_container',
      activeRevisionAtDiagnosis: 'bba-revision',
      activeReleaseAtDiagnosis: 'b'.repeat(40),
      operation: 'GET /health',
      executionLayer: 'platform_invocation',
      handler: 'unknown',
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
