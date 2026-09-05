import { pathToFileURL } from 'node:url'

const IAM_API = 'https://iam.api.cloud.yandex.net'
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_POLL_INTERVAL_MS = 5_000
const ATTACH_RUNTIME_ROLE = 'iam.serviceAccounts.user'

class YandexIamRequestError extends Error {
  constructor(message, { retryable }) {
    super(message)
    this.name = 'YandexIamRequestError'
    this.retryable = retryable
  }
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

function positiveInteger(value, field) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${field} must be a positive integer`)
  }
  return number
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value == null) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`)
    }
    options[key.slice(2).replaceAll('-', '_')] = value
  }
  return options
}

async function requestJson(url, token, fetchImpl) {
  let response
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    throw new YandexIamRequestError(
      `Yandex IAM request failed before receiving a response: ${error.message}`,
      { retryable: true },
    )
  }
  const text = await response.text()
  let body
  try {
    body = text === '' ? {} : JSON.parse(text)
  } catch {
    body = { message: text.slice(0, 500) }
  }
  if (!response.ok) {
    throw new YandexIamRequestError(
      `Yandex IAM returned HTTP ${response.status}: ${body.message ?? 'unknown error'}`,
      { retryable: response.status === 429 || response.status >= 500 },
    )
  }
  return body
}

export async function listServiceAccountBindings({
  serviceAccountId,
  token,
  fetchImpl = fetch,
}) {
  const bindings = []
  let pageToken = ''
  do {
    const url = new URL(
      `${IAM_API}/iam/v1/serviceAccounts/${encodeURIComponent(serviceAccountId)}`
        + ':listAccessBindings',
    )
    url.searchParams.set('pageSize', '1000')
    if (pageToken !== '') url.searchParams.set('pageToken', pageToken)
    const body = await requestJson(url, token, fetchImpl)
    bindings.push(...(body.accessBindings ?? []))
    pageToken = body.nextPageToken ?? ''
  } while (pageToken !== '')
  return bindings
}

export function hasServiceAccountUserBinding(bindings, deployerServiceAccountId) {
  return bindings.some(
    (binding) =>
      binding.roleId === ATTACH_RUNTIME_ROLE
      && binding.subject?.type === 'serviceAccount'
      && binding.subject.id === deployerServiceAccountId,
  )
}

export async function findMissingRuntimeBindings({
  deployerServiceAccountId,
  apiRuntimeServiceAccountId,
  migrationRuntimeServiceAccountId,
  pushDispatcherServiceAccountId,
  pushSchedulerServiceAccountId,
  token,
  fetchImpl = fetch,
}) {
  const accounts = [
    ['deployer itself', deployerServiceAccountId],
    ['API runtime', apiRuntimeServiceAccountId],
    ['migration runtime', migrationRuntimeServiceAccountId],
    ['push dispatcher runtime', pushDispatcherServiceAccountId],
    ['push scheduler', pushSchedulerServiceAccountId],
  ]
  const results = await Promise.all(
    accounts.map(async ([label, serviceAccountId]) => ({
      label,
      serviceAccountId,
      bindings: await listServiceAccountBindings({ serviceAccountId, token, fetchImpl }),
    })),
  )
  return results
    .filter(
      ({ bindings }) =>
        !hasServiceAccountUserBinding(bindings, deployerServiceAccountId),
    )
    .map(({ label, serviceAccountId }) => `${label} (${serviceAccountId})`)
}

export async function waitForRuntimeBindings({
  deployerServiceAccountId,
  apiRuntimeServiceAccountId,
  migrationRuntimeServiceAccountId,
  pushDispatcherServiceAccountId,
  pushSchedulerServiceAccountId,
  token,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  fetchImpl = fetch,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
}) {
  const deadline = Date.now() + positiveInteger(timeoutMs, 'timeout')
  const interval = positiveInteger(pollIntervalMs, 'poll interval')
  let missing = []
  do {
    try {
      missing = await findMissingRuntimeBindings({
        deployerServiceAccountId,
        apiRuntimeServiceAccountId,
        migrationRuntimeServiceAccountId,
        pushDispatcherServiceAccountId,
        pushSchedulerServiceAccountId,
        token,
        fetchImpl,
      })
    } catch (error) {
      if (!(error instanceof YandexIamRequestError) || !error.retryable) throw error
      if (Date.now() >= deadline) {
        throw new Error(
          `Yandex IAM access verification did not recover before timeout: ${error.message}`,
        )
      }
      process.stdout.write('Waiting for Yandex IAM API availability.\n')
      await sleep(Math.min(interval, Math.max(1, deadline - Date.now())))
      continue
    }
    if (missing.length === 0) return
    if (Date.now() >= deadline) break
    process.stdout.write(`Waiting for IAM propagation: ${missing.join(', ')}\n`)
    await sleep(Math.min(interval, Math.max(1, deadline - Date.now())))
  } while (Date.now() <= deadline)

  throw new Error(
    `Missing ${ATTACH_RUNTIME_ROLE} for the deployer on: ${missing.join(', ')}`,
  )
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await waitForRuntimeBindings({
    deployerServiceAccountId: requiredString(
      options.deployer_sa_id,
      '--deployer-sa-id',
    ),
    apiRuntimeServiceAccountId: requiredString(
      options.api_runtime_sa_id,
      '--api-runtime-sa-id',
    ),
    migrationRuntimeServiceAccountId: requiredString(
      options.migration_runtime_sa_id,
      '--migration-runtime-sa-id',
    ),
    pushDispatcherServiceAccountId: requiredString(
      options.push_dispatcher_sa_id,
      '--push-dispatcher-sa-id',
    ),
    pushSchedulerServiceAccountId: requiredString(
      options.push_scheduler_sa_id,
      '--push-scheduler-sa-id',
    ),
    token: requiredString(process.env.YC_TOKEN, 'YC_TOKEN'),
  })
  process.stdout.write('Runtime identity permissions are effective.\n')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
