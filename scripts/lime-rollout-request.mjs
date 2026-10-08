import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const targets = ['client', 'trainer', 'trainer-schedule']
const modes = ['pilot', 'all', 'off']
export function buildLimeRolloutRequest(env) {
  const target = env.LIME_TARGET
  const mode = env.LIME_MODE
  const revision = env.EXPECTED_REVISION ?? ''
  const confirmation = env.CONFIRMATION ?? ''
  if (!targets.includes(target)) throw new Error('Invalid rollout target')
  if (mode === 'inspect') {
    if (revision !== '' || confirmation !== '') throw new Error('Inspect must not contain mutation inputs')
    return { target, mode }
  }
  if (!modes.includes(mode)) throw new Error('Invalid rollout mode')
  if (!/^(0|[1-9][0-9]*)$/.test(revision) || Number(revision) >= 2_147_483_647) throw new Error('Supply the inspected revision')
  const expected = `SET_${target.replace('-', '_').toUpperCase()}_LIME_${mode.toUpperCase()}`
  if (confirmation !== expected) throw new Error('Explicit operation confirmation is required')
  return { target, mode, expectedRevision: Number(revision), confirmation }
}
export function readLimeRolloutState(response) {
  if (typeof response !== 'object' || response === null
    || !modes.includes(response.clientMode) || !modes.includes(response.trainerMode)
    || !modes.includes(response.scheduleMode) || !Number.isSafeInteger(response.revision)
    || response.revision < 0 || (response.trainerMode === 'all' && response.scheduleMode !== 'all')) throw new Error('Invalid private rollout readback')
  return { clientMode: response.clientMode, trainerMode: response.trainerMode, scheduleMode: response.scheduleMode, revision: response.revision }
}
export function verifyLimeRolloutResponse(response, request) {
  const state = readLimeRolloutState(response)
  if (response.status !== (request.mode === 'inspect' ? 'lime_rollout_inspected' : 'lime_rollout_updated')) throw new Error('Unexpected rollout operation status')
  if (request.mode !== 'inspect') {
    const key = request.target === 'client' ? 'clientMode' : request.target === 'trainer' ? 'trainerMode' : 'scheduleMode'
    if (state[key] !== request.mode || state.revision !== request.expectedRevision + 1) throw new Error('Rollout did not confirm the requested change')
  }
  return state
}
export function verifyLimeRolloutReadback(response, readback) {
  if (readback.status !== 'lime_rollout_inspected'
    || JSON.stringify(readLimeRolloutState(response)) !== JSON.stringify(readLimeRolloutState(readback))) throw new Error('Rollout changed before readback; inspect, do not replay')
  return readLimeRolloutState(readback)
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const request = buildLimeRolloutRequest(process.env)
    if (process.argv[2] === 'request') process.stdout.write(JSON.stringify(request))
    else if (process.argv[2] === 'verify') {
      const response = JSON.parse(readFileSync(process.argv[3], 'utf8'))
      verifyLimeRolloutResponse(response, request)
      const readback = JSON.parse(readFileSync(process.argv[4], 'utf8'))
      process.stdout.write(JSON.stringify(verifyLimeRolloutReadback(response, readback)))
    } else throw new Error('Unknown rollout helper operation')
  } catch { console.error('Rollout validation failed; inspect before any retry.'); process.exitCode = 1 }
}
