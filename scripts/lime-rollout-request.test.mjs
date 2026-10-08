import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLimeRolloutRequest, verifyLimeRolloutReadback, verifyLimeRolloutResponse } from './lime-rollout-request.mjs'

const state = { clientMode: 'pilot', trainerMode: 'pilot', scheduleMode: 'pilot', revision: 0 }
test('inspect is the non-mutating default and rejects extra mutation inputs', () => {
  assert.deepEqual(buildLimeRolloutRequest({ LIME_TARGET: 'client', LIME_MODE: 'inspect' }), { target: 'client', mode: 'inspect' })
  assert.throws(() => buildLimeRolloutRequest({ LIME_TARGET: 'client', LIME_MODE: 'inspect', CONFIRMATION: 'SET_CLIENT_LIME_ALL' }))
})
test('every write requires the exact target/mode confirmation and explicit nonnegative revision', () => {
  for (const target of ['client', 'trainer', 'trainer-schedule']) for (const mode of ['pilot', 'all', 'off']) {
    const confirmation = `SET_${target.replace('-', '_').toUpperCase()}_LIME_${mode.toUpperCase()}`
    const env = { LIME_TARGET: target, LIME_MODE: mode, EXPECTED_REVISION: '4', CONFIRMATION: confirmation }
    assert.deepEqual(buildLimeRolloutRequest(env), { target, mode, expectedRevision: 4, confirmation })
    for (const revision of ['', '-1', '1.5', '01', 'NaN', '2147483647']) assert.throws(() => buildLimeRolloutRequest({ ...env, EXPECTED_REVISION: revision }))
    assert.throws(() => buildLimeRolloutRequest({ ...env, CONFIRMATION: '' }))
    assert.throws(() => buildLimeRolloutRequest({ ...env, LIME_TARGET: 'unknown' }))
  }
})
test('response must confirm the requested mode and successor revision', () => {
  const request = buildLimeRolloutRequest({ LIME_TARGET: 'client', LIME_MODE: 'all', EXPECTED_REVISION: '0', CONFIRMATION: 'SET_CLIENT_LIME_ALL' })
  const response = { ...state, status: 'lime_rollout_updated', clientMode: 'all', revision: 1 }
  assert.equal(verifyLimeRolloutResponse(response, request).clientMode, 'all')
  assert.throws(() => verifyLimeRolloutResponse({ ...response, revision: 2 }, request))
  assert.throws(() => verifyLimeRolloutResponse({ ...response, clientMode: 'pilot' }, request))
  assert.throws(() => verifyLimeRolloutResponse({ ...response, trainerMode: 'all' }, request))
})
test('independent readback must match every mode and revision; mismatches require inspection', () => {
  const response = { ...state, status: 'lime_rollout_updated', clientMode: 'all', revision: 1 }
  const readback = { ...response, status: 'lime_rollout_inspected' }
  assert.deepEqual(verifyLimeRolloutReadback(response, readback), { ...state, clientMode: 'all', revision: 1 })
  assert.throws(() => verifyLimeRolloutReadback(response, { ...readback, trainerMode: 'off' }))
  assert.throws(() => verifyLimeRolloutReadback(response, { ...readback, revision: 2 }))
})
