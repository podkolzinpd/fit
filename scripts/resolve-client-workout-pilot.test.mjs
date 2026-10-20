import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolveClientWorkoutProfiles } from './resolve-client-workout-pilot.mjs'

const cohort = { clients: [1, 2, 3, 4, 5].map(n => String(n).repeat(64)), trainers: [6, 7].map(n => String(n).repeat(64)) }
const rows = [...cohort.clients, ...cohort.trainers].map((hash, i) => ({ hash, id: `10000000-0000-4000-8000-00000000000${i + 1}`, role: i < 5 ? 'client' : 'trainer', enabled: true }))
function fixture(values = rows, readonly = 'on') {
  const calls = []
  return { calls, query: async (sql, params) => {
    calls.push({ sql, params })
    return { rows: sql.includes('current_setting') ? [{ readonly }] : sql.includes('from app_private') ? values : [] }
  } }
}
test('resolve exact approved bound clients separately from trainers without any writes', async () => {
  const client = fixture()
  const result = await resolveClientWorkoutProfiles(client, cohort)
  assert.equal(result.clientProfileIds.length, 5); assert.equal(result.trainerProfileIds.length, 2)
  assert.equal(client.calls[0].sql, 'begin read only'); assert.equal(client.calls.at(-1).sql, 'commit')
  assert.ok(client.calls.every(c => !/insert|update|delete|alter|create|drop/i.test(c.sql)))
})
test('missing, disabled, duplicated and role-substituted profiles fail closed and roll back', async () => {
  for (const values of [rows.slice(1), rows.map((r, i) => i ? r : { ...r, enabled: false }), rows.map((r, i) => i ? r : { ...r, role: 'trainer' }), rows.map((r, i) => i ? r : rows[1])]) {
    const client = fixture(values)
    await assert.rejects(resolveClientWorkoutProfiles(client, cohort), /profiles_not_ready/)
    assert.equal(client.calls.at(-1).sql, 'rollback')
  }
})
test('invalid cohort and writable connection cannot inspect profiles', async () => {
  const invalid = fixture()
  await assert.rejects(resolveClientWorkoutProfiles(invalid, { ...cohort, clients: [] }), /cohort_rejected/)
  assert.equal(invalid.calls.length, 0)
  const writable = fixture(rows, 'off')
  await assert.rejects(resolveClientWorkoutProfiles(writable, cohort), /readonly_required/)
  assert.equal(writable.calls.at(-1).sql, 'rollback')
})

test('profile inspection is current-main, bounded, private and does not change production settings', () => {
  const workflow = readFileSync(new URL('../.github/workflows/inspect-client-workout-pilot.yml', import.meta.url), 'utf8')
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow, /test "\$\(hostname\)" = fit-stage-app/)
  assert.match(workflow, /--read-only/)
  assert.match(workflow, /--timeout=25/)
  assert.match(workflow, /retention-days: 1/)
  assert.doesNotMatch(workflow, /gh variable set|role: write|terraform|YC_TOKEN/)
  const blocks = [...workflow.matchAll(/        run: \|\n((?:          [^\n]*\n|\n)+)/g)]
  assert.equal(blocks.length, 1)
  for (const block of blocks) assert.equal(spawnSync('bash', ['-n'], {input:block[1].split('\n').map(l => l.startsWith('          ') ? l.slice(10) : l).join('\n'),encoding:'utf8'}).status, 0)
})
