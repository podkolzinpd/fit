import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { deployFrontendProbe, probeFunctionName, probeTimerName } from './deploy-frontend-gateway-probe.mjs'

const folder = 'b1goqho12tlk9dibc3f3'
const timer = { id: 'timer', name: probeTimerName, status: 'PAUSED', rule: { timer: {
  cron_expression: '17 * * * ? *', invoke_function_with_retry: {
    function_id: 'function', function_tag: 'hourly-probe', service_account_id: 'invoker',
    retry_settings: { retry_attempts: '1', interval: '10s' },
  } } } }
function fixture({ existing = false, smoke = { measured: true, status: 'passed', requests: 2 },
  existingTimer = timer, readbackTimer = { ...timer, status: 'ACTIVE' }, failInventory = false } = {}) {
  const calls = []
  const call = async (args) => {
    calls.push(args)
    const command = args.slice(0, 4).join(' ')
    if (command === 'serverless trigger list') {
      if (failInventory) throw new Error('Inventory unavailable')
      return existing ? [existingTimer] : []
    }
    if (command === 'iam service-account list') return [{ id: 'invoker', name: 'fit-stage-api-warmer' }]
    if (command === 'serverless function list') return existing ? [{ id: 'function', name: probeFunctionName }] : []
    if (args[1] === 'trigger' && args[2] === 'get') return readbackTimer
    if (args[2] === 'invoke') return smoke
    return { id: args[2] === 'version' ? 'version' : args[1] === 'function' ? 'function' : 'timer' }
  }
  const run = (overrides = {}) => deployFrontendProbe({ action: 'enable', approved: true,
    configuredFolder: folder, sourcePath: 'package', now: () => Date.parse('2026-10-05T12:00:00Z'),
    call, ...overrides })
  return { calls, run }
}

test('unapproved activation, wrong folder and invalid action perform no cloud calls', async () => {
  const { calls, run } = fixture()
  for (const overrides of [{ approved: false }, { configuredFolder: 'other' }, { action: 'delete' }]) {
    await assert.rejects(run(overrides))
  }
  assert.deepEqual(calls, [])
})

test('bootstrap is private, credential-free, bounded and smoke-gated before timer creation', async () => {
  const { calls, run } = fixture()
  const result = await run()
  assert.equal(result.expiresAt, '2026-10-06T12:00:00.000Z')
  const version = calls.find((args) => args.slice(0, 4).join(' ') === 'serverless function version create')
  for (const [flag, value] of [['--memory', '128MB'], ['--execution-timeout', '60s'],
    ['--runtime', 'nodejs22'], ['--tags', 'candidate'], ['--concurrency', '1']]) {
    assert.equal(version[version.indexOf(flag) + 1], value)
  }
  assert.ok(!version.includes('--service-account-id'))
  const binding = calls.find((args) => args[2] === 'add-access-binding')
  assert.equal(binding[binding.indexOf('--role') + 1], 'functions.functionInvoker')
  assert.ok(calls.some((args) => args[2] === 'deny-unauthenticated-invoke'))
  const smokeIndex = calls.findIndex((args) => args[2] === 'invoke')
  const promoteIndex = calls.findIndex((args) => args[3] === 'set-tag')
  const timerIndex = calls.findIndex((args) => args.slice(0, 4).join(' ') === 'serverless trigger create timer')
  assert.ok(smokeIndex < promoteIndex && promoteIndex < timerIndex)
  assert.deepEqual(calls.at(-1), ['serverless', 'trigger', 'get', '--id', 'timer'])
  assert.equal(calls[timerIndex][calls[timerIndex].indexOf('--invoke-function-tag') + 1], 'hourly-probe')
  assert.doesNotMatch(JSON.stringify(calls), /allow-unauthenticated|scaling-policy|lockbox|\$latest/)
})

test('failed smoke preserves timer and live tag; unavailable inventory does not create resources', async () => {
  for (const config of [{ existing: true, smoke: { status: 'failed', requests: 2 } },
    { failInventory: true }]) {
    const { calls, run } = fixture(config)
    await assert.rejects(run())
    assert.ok(!calls.some((args) => args[3] === 'set-tag' || args[2] === 'resume'))
    assert.ok(!calls.some((args) => args[1] === 'trigger' && args[2] === 'create'))
  }
})

test('existing timer must match reviewed contract; measured network failure does not block observation', async () => {
  const bad = fixture({ existing: true, existingTimer: { ...timer, rule: {} } })
  await assert.rejects(bad.run(), /differs/)
  assert.equal(bad.calls.length, 3)
  const valid = fixture({ existing: true, smoke: { measured: true, status: 'failed', requests: 2 } })
  await valid.run()
  assert.ok(valid.calls.some((args) => args[2] === 'resume'))
  assert.ok(!valid.calls.some((args) => args[2] === 'create' && args[1] === 'trigger'))
})

test('actual YC retry envelope works for creation readback and existing timer reuse', async () => {
  for (const existing of [false, true]) {
    const { calls, run } = fixture({ existing })
    const result = await run()
    assert.equal(result.status, 'enabled')
    assert.equal(result.timerId, 'timer')
    assert.equal(calls.filter((args) => args[1] === 'trigger' && args[2] === 'create').length, existing ? 0 : 1)
  }
})

test('unexpected actual timer target, schedule, retries and status fail closed', async () => {
  const invocation = timer.rule.timer.invoke_function_with_retry
  const invalidRules = [
    { ...timer.rule.timer, cron_expression: '* * * * ? *' },
    ...[{ function_id: 'other' }, { function_tag: '$latest' }, { service_account_id: 'other' },
      { retry_settings: { retry_attempts: '2', interval: '10s' } },
      { retry_settings: { retry_attempts: '0', interval: '10s' } },
      { retry_settings: { retry_attempts: '1', interval: '1s' } },
      { retry_settings: undefined },
    ].map((change) => ({ ...timer.rule.timer, invoke_function_with_retry: { ...invocation, ...change } })),
    { cron_expression: timer.rule.timer.cron_expression, invoke_function: invocation },
  ]
  for (const rule of invalidRules) {
    const unexpected = { ...timer, status: 'ACTIVE', rule: { timer: rule } }
    const existing = fixture({ existing: true, existingTimer: unexpected })
    await assert.rejects(existing.run(), /differs/)
    assert.equal(existing.calls.length, 3)
    const readback = fixture({ readbackTimer: unexpected })
    await assert.rejects(readback.run(), /readback failed/)
  }
  const paused = fixture({ readbackTimer: timer })
  await assert.rejects(paused.run(), /readback failed/)
})

test('disable/inspect work without cost approval and cannot create functions', async () => {
  for (const action of ['disable', 'inspect']) {
    const { calls, run } = fixture({ existing: true })
    await run({ action, approved: false })
    assert.equal(calls.length, action === 'disable' ? 2 : 1)
    if (action === 'disable') assert.deepEqual(calls[1], ['serverless', 'trigger', 'pause', '--id', 'timer'])
  }
})

test('manual-only workflow gates main/cost before credentials and packages every runtime import', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-yandex-frontend-probe.yml', import.meta.url), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /\n  (push|schedule|pull_request):/)
  assert.match(workflow, /default: inspect/)
  assert.match(workflow, /default: false/)
  assert.match(workflow, /github.ref == 'refs\/heads\/main'.*inputs.cost_approved == true/)
  assert.match(workflow, /cancel-in-progress: false/)
  for (const file of ['frontend-gateway-probe-function.mjs', 'frontend-gateway-health.mjs',
    'probe-frontend-gateway-warmup.mjs', 'probe-production-frontend.mjs']) assert.ok(workflow.includes(file))
  assert.doesNotMatch(workflow, /secrets\.|slack|telegram|PROBE_EXPIRES_AT.*vars/)
})
