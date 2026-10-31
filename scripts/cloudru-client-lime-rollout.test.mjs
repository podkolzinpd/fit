import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { boundedClientLimeManager, readClientLimeOperation, runClientLimeOperation } from './cloudru-client-lime-rollout.mjs'

const env = { GITHUB_REPOSITORY: 'podkolzinpd/fit', GITHUB_REF: 'refs/heads/main', LIME_TARGET: 'client', LIME_MODE: 'inspect' }
const state = { clientMode: 'pilot', trainerMode: 'all', scheduleMode: 'all', revision: 5 }
const all = { ...env, LIME_MODE: 'all', EXPECTED_REVISION: '5', CONFIRMATION: 'SET_CLIENT_LIME_ALL' }

test('rejects a foreign role, ref or unconfirmed mutation before any database call', async () => {
  for (const invalid of [{ ...env, LIME_TARGET: 'trainer' }, { ...env, GITHUB_REF: 'refs/heads/topic' },
    { ...env, GITHUB_REPOSITORY: 'other/repo' }, { ...all, CONFIRMATION: '' }]) {
    assert.throws(() => readClientLimeOperation(invalid))
    await assert.rejects(runClientLimeOperation({ apply() { assert.fail('must not query') } }, invalid))
  }
})

test('inspect performs exactly one read without profile or product data', async () => {
  const calls = []
  const report = await runClientLimeOperation({ async apply(command) { calls.push(command); return state } }, env)
  assert.deepEqual(calls, [{ target: 'client', mode: 'inspect' }])
  assert.deepEqual(report, { event: 'client_lime_rollout', operation: 'inspect', ...state })
})

test('all, pilot and off reuse one atomic setter then independently inspect', async () => {
  for (const mode of ['all', 'pilot', 'off']) {
    const calls = []
    const after = { ...state, clientMode: mode, revision: 6 }
    const report = await runClientLimeOperation({ async apply(command) {
      calls.push(command)
      return calls.length === 1 ? state : after
    } }, { ...all, LIME_MODE: mode, CONFIRMATION: `SET_CLIENT_LIME_${mode.toUpperCase()}` })
    assert.deepEqual(calls, [{ target: 'client', mode: 'inspect' },
      { target: 'client', mode, expectedRevision: 5 }, { target: 'client', mode: 'inspect' }])
    assert.deepEqual(report, { event: 'client_lime_rollout', operation: mode, ...after })
  }
})

test('stale expected revision never writes', async () => {
  let calls = 0
  await assert.rejects(runClientLimeOperation({ async apply() { calls++; return { ...state, revision: 6 } } }, all), /revision_conflict/)
  assert.equal(calls, 1)
})

test('uncertain write and changed readback fail without replay', async () => {
  for (const failure of ['write', 'readback', 'other-role']) {
    const calls = []
    await assert.rejects(runClientLimeOperation({ async apply(command) {
      calls.push(command)
      if (calls.length === 1) return state
      if (failure === 'write') throw new Error('connection lost after dispatch')
      const next = { ...state, clientMode: 'all', revision: 6 }
      if (failure === 'other-role') return { ...next, trainerMode: 'off' }
      return calls.length === 3 ? { ...next, revision: 7 } : next
    } }, all))
    assert.equal(calls.filter(command => command.mode !== 'inspect').length, 1)
  }
})


test('the operator keeps client deadlines without unsupported database startup parameters', () => {
  const source = readFileSync(new URL('./cloudru-client-lime-rollout.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /statement_timeout\s*:|options\s*:/)
  assert.match(source, /max: 1, query_timeout: 10000/)
  assert.match(source, /import\('\/app\/dist\/background-transaction\.js'\)/)
})

test('existing manager calls finish their own bounded transaction before independent readback', async () => {
  const events = []
  let transactions = 0
  let stateNow = state
  const connection = { async query(command) {
    events.push(command.mode)
    if (command.mode !== 'inspect') stateNow = { ...stateNow, clientMode: command.mode, revision: stateNow.revision + 1 }
    return stateNow
  } }
  class Manager {
    constructor(pool) { this.pool = pool }
    async apply(command) {
      const lease = await this.pool.connect()
      try { return await lease.query(command) } finally { lease.release() }
    }
  }
  const withTransaction = async (pool, work) => {
    assert.equal(pool, 'existing-owner-pool')
    const tx = ++transactions
    events.push(`begin${tx}`)
    const result = await work(connection)
    events.push(`commit${tx}`)
    return result
  }
  const manager = boundedClientLimeManager('existing-owner-pool', Manager, withTransaction)
  assert.deepEqual(await runClientLimeOperation(manager, all), { event: 'client_lime_rollout', operation: 'all', ...state, clientMode: 'all', revision: 6 })
  assert.deepEqual(events, ['begin1', 'inspect', 'commit1', 'begin2', 'all', 'commit2', 'begin3', 'inspect', 'commit3'])
})

test('uncertain transaction commit stops without repeating the setter or starting readback', async () => {
  let calls = 0
  const commitFailure = new Error('uncertain commit')
  class Manager {
    async apply(command) { calls++; return command.mode === 'inspect' ? state : { ...state, clientMode: 'all', revision: 6 } }
  }
  const manager = boundedClientLimeManager(null, Manager, async (_pool, work) => {
    const result = await work({})
    if (calls === 2) throw commitFailure
    return result
  })
  await assert.rejects(runClientLimeOperation(manager, all), error => error === commitFailure)
  assert.equal(calls, 2)
})
