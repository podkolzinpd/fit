import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const CONTAINERS_API = 'https://serverless-containers.api.cloud.yandex.net'
const OPERATIONS_API = 'https://operation.api.cloud.yandex.net'
const DEFAULT_TIMEOUT_MS = 180_000
const POLL_INTERVAL_MS = 2_000
const DEFAULT_REQUEST_ATTEMPTS = 3
const DEFAULT_RETRY_DELAY_MS = 500
const NANOSECONDS_PER_SECOND = 1_000_000_000n
const DURATION_UNIT_NANOSECONDS = {
  h: 3_600_000_000_000n,
  m: 60_000_000_000n,
  s: NANOSECONDS_PER_SECOND,
  ms: 1_000_000n,
  us: 1_000n,
  'µs': 1_000n,
  'μs': 1_000n,
  ns: 1n,
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

function requiredInteger(value, field) {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    throw new Error(`${field} must be a non-negative integer`)
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${field} must be a non-negative integer`)
  }
  return number
}

export function normalizeExecutionTimeout(value) {
  const duration = requiredString(value, 'execution timeout').trim()
  const componentPattern = /(\d+(?:\.\d+)?)(ns|us|µs|μs|ms|s|m|h)/gu
  let totalNanoseconds = 0n
  let consumed = 0

  for (const match of duration.matchAll(componentPattern)) {
    if (match.index !== consumed) {
      throw new Error('execution timeout must use Go duration syntax')
    }
    const [whole, fraction = ''] = match[1].split('.')
    const denominator = 10n ** BigInt(fraction.length)
    const numerator = BigInt(whole) * denominator + BigInt(fraction || '0')
    const unitNanoseconds = DURATION_UNIT_NANOSECONDS[match[2]]
    const scaledNanoseconds = numerator * unitNanoseconds
    if (scaledNanoseconds % denominator !== 0n) {
      throw new Error('execution timeout has sub-nanosecond precision')
    }
    totalNanoseconds += scaledNanoseconds / denominator
    consumed += match[0].length
  }

  if (consumed !== duration.length || totalNanoseconds <= 0n) {
    throw new Error('execution timeout must be a positive Go duration')
  }

  const seconds = totalNanoseconds / NANOSECONDS_PER_SECOND
  const fractionalNanoseconds = totalNanoseconds % NANOSECONDS_PER_SECOND
  const fraction = fractionalNanoseconds
    .toString()
    .padStart(9, '0')
    .replace(/0+$/u, '')
  return `${seconds}${fraction === '' ? '' : `.${fraction}`}s`
}

function optionalBlock(blocks, field) {
  if (blocks == null) return undefined
  if (!Array.isArray(blocks) || blocks.length > 1) {
    throw new Error(`${field} must be a Terraform block list with at most one item`)
  }
  return blocks[0]
}

function allResources(module) {
  return [
    ...(module?.resources ?? []),
    ...(module?.child_modules ?? []).flatMap(allResources),
  ]
}

export function findPlannedResource(plan, address) {
  const resource = allResources(plan?.planned_values?.root_module).find(
    (candidate) => candidate.address === address,
  )
  if (!resource) {
    throw new Error(`Terraform plan does not contain ${address}`)
  }
  return resource
}

export function hasPlannedChange(plan, address) {
  const change = (plan?.resource_changes ?? []).find(
    (candidate) => candidate.address === address,
  )
  return change != null && !(
    change.change?.actions?.length === 1 && change.change.actions[0] === 'no-op'
  )
}

export function buildDeployRevisionRequest(values) {
  const image = optionalBlock(values.image, 'image')
  if (!image) throw new Error('image block is required')

  const connectivity = optionalBlock(values.connectivity, 'connectivity')
  const logOptions = optionalBlock(values.log_options, 'log_options')
  const runtime = optionalBlock(values.runtime, 'runtime')
  const command = Array.isArray(image.command) ? image.command : []
  const args = Array.isArray(image.args) ? image.args : []
  const memoryMb = requiredInteger(values.memory, 'memory')
  const cores = requiredInteger(values.cores, 'cores')
  const coreFraction = requiredInteger(values.core_fraction, 'core fraction')
  const concurrency = requiredInteger(values.concurrency, 'concurrency')

  const request = {
    containerId: requiredString(values.id, 'container id'),
    resources: {
      memory: String(memoryMb * 1024 * 1024),
      cores: String(cores),
      coreFraction: String(coreFraction),
    },
    executionTimeout: normalizeExecutionTimeout(values.execution_timeout),
    serviceAccountId: requiredString(values.service_account_id, 'service account id'),
    imageSpec: {
      imageUrl: requiredString(image.url, 'image URL'),
      environment: image.environment ?? {},
    },
    concurrency: String(concurrency),
  }

  if (command.length > 0) request.imageSpec.command = { command }
  if (args.length > 0) request.imageSpec.args = { args }
  if (image.work_dir) request.imageSpec.workingDir = image.work_dir

  if (connectivity?.network_id) {
    request.connectivity = { networkId: connectivity.network_id }
  }

  if (Array.isArray(values.secrets) && values.secrets.length > 0) {
    request.secrets = values.secrets.map((secret) => ({
      id: requiredString(secret.id, 'secret id'),
      versionId: requiredString(secret.version_id, 'secret version id'),
      key: requiredString(secret.key, 'secret key'),
      environmentVariable: requiredString(
        secret.environment_variable,
        'secret environment variable',
      ),
    }))
  }

  if (logOptions) {
    request.logOptions = {
      disabled: Boolean(logOptions.disabled),
      minLevel: logOptions.min_level || 'INFO',
    }
    if (logOptions.folder_id) request.logOptions.folderId = logOptions.folder_id
    if (logOptions.log_group_id) request.logOptions.logGroupId = logOptions.log_group_id
  }

  if (runtime?.type === 'task') request.runtime = { task: {} }
  else request.runtime = { http: {} }

  return request
}

export function formatYandexCloudApiError({ operation, status, body, headers }) {
  const requestId = headers?.get?.('x-request-id')
    ?? headers?.get?.('x-server-trace-id')
  const diagnostics = [
    body?.code == null ? null : `code: ${String(body.code)}`,
    requestId == null || requestId === '' ? null : `request ID: ${requestId}`,
  ].filter(Boolean)
  const permissionHint = operation === 'DeployRevision request' && status === 403
    ? ' Verify that the deploy service account has an explicit '
      + 'iam.serviceAccounts.user role on the stage folder; if it does, '
      + 'contact Yandex Cloud support with the request ID.'
    : ''
  return `Yandex Cloud ${operation} returned HTTP ${status}: `
    + `${body?.message ?? 'unknown error'}`
    + (diagnostics.length === 0 ? '' : ` (${diagnostics.join(', ')})`)
    + permissionHint
}

class YandexCloudRequestError extends Error {
  constructor(message, { retryable }) {
    super(message)
    this.name = 'YandexCloudRequestError'
    this.retryable = retryable
  }
}

async function requestJsonOnce(url, token, options, operation, fetchImpl) {
  let response
  let text
  try {
    response = await fetchImpl(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
    text = await response.text()
  } catch (error) {
    throw new YandexCloudRequestError(
      `Yandex Cloud ${operation} failed before receiving a response: ${error.message}`,
      { retryable: true },
    )
  }
  let body
  try {
    body = text === '' ? {} : JSON.parse(text)
  } catch {
    body = { message: text.slice(0, 500) }
  }
  if (!response.ok) {
    throw new YandexCloudRequestError(
      formatYandexCloudApiError({
        operation,
        status: response.status,
        body,
        headers: response.headers,
      }),
      { retryable: response.status === 429 || response.status >= 500 },
    )
  }
  return body
}

export async function requestJson(
  url,
  token,
  options = {},
  operation = 'API request',
  {
    fetchImpl = fetch,
    sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
    maxAttempts = DEFAULT_REQUEST_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = {},
) {
  const attempts = requiredInteger(maxAttempts, 'request attempts')
  if (attempts === 0) throw new Error('request attempts must be positive')
  const delay = requiredInteger(retryDelayMs, 'retry delay')

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestJsonOnce(url, token, options, operation, fetchImpl)
    } catch (error) {
      if (
        !(error instanceof YandexCloudRequestError)
        || !error.retryable
        || attempt === attempts
      ) {
        throw error
      }
      process.stdout.write(
        `Retrying Yandex Cloud ${operation} after a transient failure `
          + `(attempt ${attempt + 1}/${attempts}).\n`,
      )
      await sleep(delay * (2 ** (attempt - 1)))
    }
  }

  throw new Error(`Yandex Cloud ${operation} exhausted all request attempts`)
}

async function waitForOperation(operationId, token, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const operation = await requestJson(
      `${OPERATIONS_API}/operations/${encodeURIComponent(operationId)}`,
      token,
      {},
      'operation poll',
    )
    if (operation.done) {
      if (operation.error) {
        throw new Error(
          `Yandex Cloud operation failed: ${operation.error.message ?? 'unknown error'}`,
        )
      }
      return operation
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`Yandex Cloud operation ${operationId} timed out`)
}

async function deployFromPlan({ planPath, address, token }) {
  const plan = JSON.parse(await readFile(planPath, 'utf8'))
  if (!hasPlannedChange(plan, address)) {
    process.stdout.write(`No revision change planned for ${address}; reusing it.\n`)
    return
  }
  const resource = findPlannedResource(plan, address)
  const request = buildDeployRevisionRequest(resource.values)
  const operation = await requestJson(
    `${CONTAINERS_API}/containers/v1/revisions:deploy`,
    token,
    { method: 'POST', body: JSON.stringify(request) },
    'DeployRevision request',
  )
  requiredString(operation.id, 'operation id')
  const completed = await waitForOperation(operation.id, token)
  const revisionId = completed.response?.id ?? completed.metadata?.revisionId ?? ''
  process.stdout.write(
    `Deployed ${address} with image ${request.imageSpec.imageUrl}` +
      (revisionId ? ` as revision ${revisionId}` : '') +
      '\n',
  )
}

async function rollback({ containerId, revisionId, token }) {
  requiredString(containerId, 'container id')
  requiredString(revisionId, 'revision id')
  const operation = await requestJson(
    `${CONTAINERS_API}/containers/v1/containers/${encodeURIComponent(containerId)}:rollback`,
    token,
    { method: 'POST', body: JSON.stringify({ revisionId }) },
    'rollback request',
  )
  requiredString(operation.id, 'operation id')
  await waitForOperation(operation.id, token)
  process.stdout.write(`Rolled back container ${containerId} to revision ${revisionId}\n`)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { command }
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (!key?.startsWith('--') || value == null) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`)
    }
    options[key.slice(2).replaceAll('-', '_')] = value
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const token = requiredString(process.env.YC_TOKEN, 'YC_TOKEN')
  if (options.command === 'deploy') {
    await deployFromPlan({
      planPath: requiredString(options.plan, '--plan'),
      address: requiredString(options.address, '--address'),
      token,
    })
    return
  }
  if (options.command === 'rollback') {
    await rollback({
      containerId: requiredString(options.container_id, '--container-id'),
      revisionId: requiredString(options.revision_id, '--revision-id'),
      token,
    })
    return
  }
  throw new Error('Expected deploy or rollback command')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
