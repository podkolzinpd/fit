import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readAccountLinkTargets, inspectAccountLinks } from './cloudru-account-links-audit.mjs'

const targets = { emailHashes: ['a'.repeat(64), 'b'.repeat(64)], loginHashes: ['c'.repeat(64)] }
const oldId = '11111111-1111-4111-8111-111111111111'
const newId = '22222222-2222-4222-8222-222222222222'
const cardId = '33333333-3333-4333-8333-333333333333'

test('only bounded private hashes are accepted; no email, SQL or extra fields', () => {
  assert.deepEqual(readAccountLinkTargets(JSON.stringify(targets)), targets)
  const three = { ...targets, emailHashes: [...targets.emailHashes, 'd'.repeat(64)] }
  assert.deepEqual(readAccountLinkTargets(JSON.stringify(three)), three)
  for (const value of [null, {}, { ...targets, emailHashes: ['user@example.test', 'b'.repeat(64)] },
    { ...targets, emailHashes: [targets.emailHashes[0]] }, { ...targets, emailHashes: Array(5).fill('d'.repeat(64)) },
    { ...targets, emailHashes: [targets.emailHashes[0], targets.emailHashes[0]] },
    { ...targets, loginHashes: [] }, { ...targets, loginHashes: Array(5).fill('c'.repeat(64)) },
    { ...targets, sql: 'select * from profiles' }]) {
    assert.throws(() => readAccountLinkTargets(JSON.stringify(value)), /targets_invalid/)
  }
})

test('owner and READ ONLY gates run before reading application tables', async () => {
  for (const row of [{ username: 'fit_owner', readonly: 'off' }, { username: 'fit_api', readonly: 'on' }]) {
    const calls = []
    await assert.rejects(inspectAccountLinks({ async query(sql) { calls.push(sql); return { rows: [row] } } }, targets, []), /readonly_required/)
    assert.equal(calls.at(-1), 'rollback')
    assert.equal(calls.some(sql => sql.includes('public.')), false)
  }
})

test('separate legacy and retained native accounts remain separate; report contains no private identifiers', async () => {
  const calls = []
  const client = { async query(sql, params) {
    calls.push({ sql, params })
    if (sql.includes('current_user')) return { rows: [{ username: 'fit_owner', readonly: 'on' }] }
    if (sql.includes('from pg_class')) return { rows: [{ name: 'synthetic_login_bindings' }] }
    if (sql.includes('select profile_id,login_sha256')) return { rows: [{ profile_id: newId, login_sha256: targets.loginHashes[0] }] }
    if (sql.includes('from public.profiles p left join')) return { rows: [
      { id: oldId, account_role: 'trainer', trainer_card: true, identity_origin: null, active_sessions: 0, target_backend: null },
      { id: newId, account_role: 'trainer', trainer_card: true, identity_origin: 'native', active_sessions: 1, target_backend: 'yandex', access_mode: 'read_write', enabled: true },
    ] }
    if (sql.includes('with recursive scope')) return { rows: [{ id: cardId, auth_user_id: null, trainer_id: oldId, archived: false, merged_into_client_id: null, depth_limit_hit: false }] }
    if (sql.includes('from public.client_trainer_relationships where')) return { rows: [{ client_id: cardId, trainer_id: oldId, status: 'active', count: 1 }] }
    if (sql.includes('select client_id,trainer_id from public.client_trainers')) return { rows: [{ client_id: cardId, trainer_id: oldId }] }
    if (sql.includes('from public.workouts where')) return { rows: [{ client_id: cardId, status: 'completed', deleted: false, count: 7 }] }
    return { rows: [] }
  } }
  const report = await inspectAccountLinks(client, targets, [{ label: 'address1', id: oldId }])
  assert.equal(report.profiles.length, 2)
  assert.equal(report.targets[0].legacyAccount, 'account1')
  assert.deepEqual(report.loginAccounts, ['account2'])
  assert.equal(report.profiles[0].yandexLinked, false)
  assert.equal(report.profiles[1].identityOrigin, 'native')
  assert.equal(report.cards[0].historicalPartition, 'account1')
  assert.equal(report.workouts[0].count, 7)
  const output = JSON.stringify(report)
  for (const value of [oldId, newId, cardId, ...targets.emailHashes, ...targets.loginHashes]) assert.equal(output.includes(value), false)
  assert.equal(calls.at(-1).sql, 'commit')
  assert.ok(calls.every(({ sql }) => !/^\s*(insert|update|delete|grant|alter|create|drop)\b/i.test(sql)))
})

test('scope overflow and query failures roll back rather than emitting partial accounts', async () => {
  for (const overflow of [true, false]) {
    const calls = []
    await assert.rejects(inspectAccountLinks({ async query(sql) {
      calls.push(sql)
      if (sql.includes('current_user')) return { rows: [{ username: 'fit_owner', readonly: 'on' }] }
      if (sql.includes('from pg_class')) {
        if (!overflow) throw Error('synthetic DB failure')
        return { rows: Array(21).fill({ name: 'synthetic' }) }
      }
      return { rows: [] }
    } }, targets, []))
    assert.equal(calls.at(-1), 'rollback')
    assert.equal(calls.includes('commit'), false)
  }
})

test('transport is manual trusted-main only, isolated from other account investigations', () => {
  const source = readFileSync(new URL('../.github/workflows/inspect-account-links.yml', import.meta.url), 'utf8')
  assert.match(source, /workflow_dispatch:/)
  assert.doesNotMatch(source, /schedule:|pull_request:|inputs:|--privileged|FIT_ACCOUNT_DELETION_TARGET|FIT_ACCOUNT_HISTORY_TARGETS/)
  assert.match(source, /FIT_ACCOUNT_LINK_AUDIT_TARGETS: \$\{\{ secrets\.FIT_ACCOUNT_LINK_AUDIT_TARGETS \}\}/)
  assert.match(source, /refs\/heads\/main/)
  assert.match(source, /--read-only/)
  assert.match(source, /group: cloudru-stage-vm/)
  assert.match(source, /trap 'sudo rm -f/)
})
