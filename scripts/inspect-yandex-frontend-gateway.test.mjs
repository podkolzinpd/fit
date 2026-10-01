import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeGateway } from './inspect-yandex-frontend-gateway.mjs'

const previousCommit = '3'.repeat(40)
const candidateCommit = '0'.repeat(40)
const sinceUtc = '2026-10-01T09:39:00Z'

test('reports a settled previous gateway without leaking the specification', () => {
  const result = summarizeGateway({
    gateway: { status: 'ACTIVE', logOptions: { disabled: true } },
    specification: { info: { version: `${previousCommit}-release` }, paths: { '/secret': { object: 'private' } } },
    operations: [{ id: 'op-1', createdAt: '2026-10-01T09:40:00Z', done: true, error: { code: 13 } }],
    previousCommit,
    candidateCommit,
    sinceUtc,
  })
  assert.equal(result.settledOnKnownVersion, true)
  assert.equal(result.activeIsPrevious, true)
  assert.equal(result.operations[0].errorCode, 13)
  assert.doesNotMatch(JSON.stringify(result), /private|secret|release/)
})

test('refuses to mark an unfinished operation or unknown spec settled', () => {
  const base = {
    gateway: { status: 'ACTIVE', logOptions: { disabled: true } },
    specification: { info: { version: `${candidateCommit}-release` } },
    previousCommit,
    candidateCommit,
    sinceUtc,
  }
  assert.equal(summarizeGateway({ ...base, operations: [{ done: false }] }).settledOnKnownVersion, false)
  assert.equal(summarizeGateway({ ...base, specification: { info: { version: 'other' } }, operations: [] }).settledOnKnownVersion, false)
  assert.equal(summarizeGateway({ ...base, operations: [] }).settledOnKnownVersion, false)
})
