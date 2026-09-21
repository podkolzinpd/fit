import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const requestId = '3ea35ed0-4895-4893-b52a-98715ab1d5fa'
const otherId = '129c90e9-8f58-4c93-8160-19d72f25f1bc'

test('accepts a bounded RFC-3339 incident window', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-yandex-incident-inputs.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      REQUEST_ID: requestId,
      SINCE_UTC: '2026-09-21T04:45:00Z',
      UNTIL_UTC: '2026-09-21T04:56:00Z',
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Validated a 660 second diagnostic window/)
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

    const result = spawnSync(process.execPath, [
      'scripts/summarize-yandex-incident-logs.mjs',
      logPath,
      requestId,
    ], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.requestMatches.length, 1)
    assert.equal(summary.requestMatches[0].requestId, requestId)
    assert.equal(summary.requestMatches[0].path, '/v1/training-data')
    assert.equal(summary.requestMatches[0].statusCode, 502)
    assert.doesNotMatch(result.stdout, new RegExp(otherId))
    assert.doesNotMatch(result.stdout, /user@example\.com|secret-token|code=secret|state=secret/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
