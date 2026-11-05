import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { managePrivateAnalyticsAccess } from './manage-private-analytics-access.mjs'

const hashes = ['a'.repeat(64), 'b'.repeat(64)]
function client(other = 0, enabled = 2) {
  const calls = []
  return { calls, async query(sql, args) {
    calls.push({ sql, args })
    if (sql.includes('not (login_sha256')) return { rows: [{ n: other }] }
    if (sql.includes('count(*) filter')) return { rows: [{ enabled, bound: 0, ready: 0 }] }
    return { rows: [] }
  } }
}
test('grant checks both targets, locks, writes and reads back inside a transaction', async () => {
  const db = client()
  assert.deepEqual(await managePrivateAnalyticsAccess(db, 'grant', hashes), { status: 'applied', enabled: 2, bound: 0, ready: 0, otherEnabled: 0 })
  assert.equal(db.calls[0].sql, 'begin')
  assert.ok(db.calls.some(call => call.sql.includes('pg_advisory_xact_lock')))
  assert.equal(db.calls.at(-1).sql, 'commit')
})
test('other enabled identities and failed postconditions roll back', async () => {
  for (const db of [client(1), client(0, 1)]) {
    await assert.rejects(managePrivateAnalyticsAccess(db, 'grant', hashes))
    assert.equal(db.calls.at(-1).sql, 'rollback')
  }
})
test('duplicate or malformed targets fail before a transaction', async () => {
  const db = client()
  await assert.rejects(managePrivateAnalyticsAccess(db, 'grant', [hashes[0], hashes[0]]))
  await assert.rejects(managePrivateAnalyticsAccess(db, 'grant', ['bad', hashes[1]]))
  assert.equal(db.calls.length, 0)
})
