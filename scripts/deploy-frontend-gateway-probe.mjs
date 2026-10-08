import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const execute = promisify(execFile)
export const probeFunctionName = 'fit-frontend-hourly-probe'
export const probeTimerName = 'fit-frontend-hourly-probe-timer'
const folderId = 'b1goqho12tlk9dibc3f3'
const liveTag = 'hourly-probe'
const cron = '17 * * * ? *'

async function yc(args) {
  try {
    const { stdout } = await execute('yc', [...args, '--folder-id', folderId,
      '--format', 'json', '--retry', '0'], { timeout: 240_000, maxBuffer: 2_000_000 })
    return stdout.trim() ? JSON.parse(stdout) : null
  } catch {
    // Do not echo CLI stderr, credentials, or arbitrary function responses.
    throw new Error(`Yandex probe command failed: ${args.slice(0, 4).join(' ')}`)
  }
}

function findNamed(resources, name) {
  if (!Array.isArray(resources)) throw new Error('Invalid Cloud resource inventory')
  const matches = resources.filter((resource) => resource.name === name)
  if (matches.length > 1) throw new Error('Ambiguous probe resource')
  return matches[0]
}

function matchesTimer(timer, functionId, invokerId) {
  const rule = timer.rule?.timer
  // YC returns invoke_function_with_retry when retry settings are configured.
  const invocation = rule?.invoke_function_with_retry
  return rule?.cron_expression === cron
    && invocation?.function_id === functionId
    && invocation?.function_tag === liveTag
    && invocation?.service_account_id === invokerId
    && ['1', 1].includes(invocation?.retry_settings?.retry_attempts)
    && invocation?.retry_settings?.interval === '10s'
}

export async function deployFrontendProbe({
  action, approved = false, sourcePath, configuredFolder,
  call = yc, now = Date.now,
}) {
  if (!['enable', 'disable', 'inspect'].includes(action)) throw new Error('Invalid probe action')
  if (configuredFolder !== folderId) throw new Error('Unexpected frontend folder')
  if (action === 'enable' && approved !== true) throw new Error('Cost approval required')
  if (action === 'enable' && !sourcePath) throw new Error('Function package required')

  const timers = await call(['serverless', 'trigger', 'list'])
  const timer = findNamed(timers, probeTimerName)
  if (action === 'inspect') return { status: timer?.status ?? 'not-created', timerId: timer?.id ?? null }
  if (action === 'disable') {
    if (timer) await call(['serverless', 'trigger', 'pause', '--id', timer.id])
    return { status: 'disabled', timerId: timer?.id ?? null }
  }

  const accounts = await call(['iam', 'service-account', 'list'])
  const invoker = findNamed(accounts, 'fit-stage-api-warmer')
  if (!invoker?.id) throw new Error('Existing timer identity not found')
  const functions = await call(['serverless', 'function', 'list'])
  let fn = findNamed(functions, probeFunctionName)
  if (timer) {
    if (!fn || !matchesTimer(timer, fn.id, invoker.id)) {
      throw new Error('Existing timer differs from the reviewed probe contract')
    }
  }
  fn ??= await call(['serverless', 'function', 'create', '--name', probeFunctionName])
  if (!fn?.id) throw new Error('Invalid function identity')
  await call(['serverless', 'function', 'deny-unauthenticated-invoke', '--id', fn.id])
  await call(['serverless', 'function', 'add-access-binding', '--id', fn.id,
    '--role', 'functions.functionInvoker', '--service-account-id', invoker.id])
  const expiresAt = new Date(now() + 24 * 60 * 60 * 1_000).toISOString()
  const version = await call(['serverless', 'function', 'version', 'create',
    '--function-id', fn.id, '--runtime', 'nodejs22', '--entrypoint', 'index.handler',
    '--memory', '128MB', '--execution-timeout', '60s', '--concurrency', '1',
    '--source-path', sourcePath, '--tags', 'candidate',
    '--environment', `PROBE_EXPIRES_AT=${expiresAt}`])
  if (!version?.id) throw new Error('Invalid function version')
  const smoke = await call(['serverless', 'function', 'invoke', '--id', fn.id,
    '--tag', 'candidate', '--data', '{}'])
  if (smoke?.measured !== true || !['passed', 'slow', 'failed'].includes(smoke.status) || smoke.requests !== 2) {
    throw new Error('Candidate probe smoke failed; timer has not been changed')
  }
  // Network failures are valid measurements; malformed/expired handlers are not.
  // The timer never invokes $latest. A failed candidate leaves its old tag intact.
  await call(['serverless', 'function', 'version', 'set-tag', '--id', version.id, '--tag', liveTag])
  const active = timer
    ? await call(['serverless', 'trigger', 'resume', '--id', timer.id])
    : await call(['serverless', 'trigger', 'create', 'timer', '--name', probeTimerName,
      '--cron-expression', cron, '--invoke-function-id', fn.id,
      '--invoke-function-tag', liveTag, '--invoke-function-service-account-id', invoker.id,
      '--retry-attempts', '1', '--retry-interval', '10s'])
  const timerId = active?.id ?? timer?.id
  if (!timerId) throw new Error('Timer identity missing after activation')
  const readback = await call(['serverless', 'trigger', 'get', '--id', timerId])
  if (readback?.status !== 'ACTIVE' || !matchesTimer(readback, fn.id, invoker.id)) {
    throw new Error('Timer activation readback failed; inspect or disable the experiment')
  }
  return { status: 'enabled', functionId: fn.id, versionId: version.id,
    timerId, expiresAt }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await deployFrontendProbe({ action: process.env.PROBE_ACTION,
      approved: process.env.PROBE_COST_APPROVED === 'true',
      configuredFolder: process.env.YC_FOLDER_ID, sourcePath: process.env.PROBE_SOURCE_PATH })
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
