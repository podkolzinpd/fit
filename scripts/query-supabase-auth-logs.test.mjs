import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLogsUrl, parseLogRange, queryLogs } from './query-supabase-auth-logs.mjs'

test('accepts a bounded UTC range and encodes the log query', () => {
  const range = parseLogRange('2026-09-01T19:30:00Z', '2026-09-01T19:40:00Z')
  const url = buildLogsUrl('project-ref', "select count() from logs where source = 'auth_logs'", range)

  assert.equal(url.pathname, '/v1/projects/project-ref/analytics/endpoints/logs')
  assert.equal(url.searchParams.get('iso_timestamp_start'), '2026-09-01T19:30:00.000Z')
  assert.match(url.searchParams.get('sql'), /auth_logs/)
})

test('rejects invalid and overly broad time ranges', () => {
  assert.throws(() => parseLogRange('invalid', '2026-09-01T19:40:00Z'), /ISO-8601/)
  assert.throws(() => parseLogRange('2026-09-01T19:40:00Z', '2026-09-01T19:30:00Z'), /after start/)
  assert.throws(() => parseLogRange('2026-09-01T18:00:00Z', '2026-09-01T19:30:00Z'), /60 minutes/)
})

test('prints only explicitly allowed aggregate fields', async () => {
  const fetchImplementation = async () => new Response(JSON.stringify({
    result: [{ minute: '2026-09-01 19:34:00', status: 504, requests: 2, email: 'hidden@example.test', ip: '127.0.0.1' }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  const rows = await queryLogs({
    accessToken: 'secret-token',
    projectId: 'project-ref',
    sql: 'select 1',
    range: parseLogRange('2026-09-01T19:30:00Z', '2026-09-01T19:40:00Z'),
    fetchImplementation,
  })

  assert.deepEqual(rows, [{ minute: '2026-09-01 19:34:00', status: 504, requests: 2 }])
})

test('does not print a remote response body on an API failure', async () => {
  const fetchImplementation = async () => new Response('sensitive remote details', { status: 403 })

  await assert.rejects(() => queryLogs({
    accessToken: 'secret-token',
    projectId: 'project-ref',
    sql: 'select 1',
    range: parseLogRange('2026-09-01T19:30:00Z', '2026-09-01T19:40:00Z'),
    fetchImplementation,
  }), { message: 'Supabase logs query failed with HTTP 403' })
})
