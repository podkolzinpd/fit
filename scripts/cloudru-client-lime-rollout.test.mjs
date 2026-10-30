import assert from 'node:assert/strict'
import test from 'node:test'
import { readClientLimeOperation, runClientLimeOperation } from './cloudru-client-lime-rollout.mjs'

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
