import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildDeployRevisionRequest,
  findPlannedResource,
  formatYandexCloudApiError,
  hasPlannedChange,
  normalizeExecutionTimeout,
  requestJson,
} from './deploy-yandex-serverless-revision.mjs'

const values = {
  id: 'container-id',
  memory: 512,
  cores: 1,
  core_fraction: 100,
  execution_timeout: '5m0s',
  service_account_id: 'runtime-sa',
  concurrency: 1,
  image: [
    {
      url: 'cr.yandex/registry/api:commit',
      command: ['node', 'dist/migration-server.js'],
      args: [],
      environment: { APP_ENV: 'stage' },
      work_dir: '',
    },
  ],
  connectivity: [{ network_id: 'network-id' }],
  secrets: [
    {
      id: 'secret-id',
      version_id: 'secret-version',
      key: 'postgresql_password',
      environment_variable: 'MIGRATION_DATABASE_PASSWORD',
    },
  ],
  log_options: [
    {
      disabled: false,
      folder_id: 'folder-id',
      log_group_id: '',
      min_level: 'INFO',
    },
  ],
  runtime: [{ type: 'http' }],
}

test('maps a Terraform container plan to the REST DeployRevision request', () => {
  assert.deepEqual(buildDeployRevisionRequest(values), {
    containerId: 'container-id',
    resources: { memory: '536870912', cores: '1', coreFraction: '100' },
    executionTimeout: '300s',
    serviceAccountId: 'runtime-sa',
    imageSpec: {
      imageUrl: 'cr.yandex/registry/api:commit',
      command: { command: ['node', 'dist/migration-server.js'] },
      environment: { APP_ENV: 'stage' },
    },
    concurrency: '1',
    connectivity: { networkId: 'network-id' },
    secrets: [
      {
        id: 'secret-id',
        versionId: 'secret-version',
        key: 'postgresql_password',
        environmentVariable: 'MIGRATION_DATABASE_PASSWORD',
      },
    ],
    logOptions: { disabled: false, minLevel: 'INFO', folderId: 'folder-id' },
    runtime: { http: {} },
  })
})

test('omits optional empty image overrides and supports task runtime', () => {
  const request = buildDeployRevisionRequest({
    ...values,
    image: [{ ...values.image[0], command: [], args: [], work_dir: '' }],
    connectivity: [],
    secrets: [],
    log_options: [],
    runtime: [{ type: 'task' }],
  })
  assert.equal(request.imageSpec.command, undefined)
  assert.equal(request.imageSpec.args, undefined)
  assert.equal(request.connectivity, undefined)
  assert.equal(request.secrets, undefined)
  assert.equal(request.logOptions, undefined)
  assert.deepEqual(request.runtime, { task: {} })
})

test('finds resources in nested Terraform modules', () => {
  const resource = { address: 'module.stage.yandex_serverless_container.api', values }
  const plan = {
    planned_values: {
      root_module: { child_modules: [{ resources: [resource] }] },
    },
  }
  assert.equal(findPlannedResource(plan, resource.address), resource)
})

test('deploys only when Terraform planned a resource change', () => {
  const address = 'yandex_serverless_container.api'
  assert.equal(
    hasPlannedChange(
      { resource_changes: [{ address, change: { actions: ['update'] } }] },
      address,
    ),
    true,
  )
  assert.equal(
    hasPlannedChange(
      { resource_changes: [{ address, change: { actions: ['no-op'] } }] },
      address,
    ),
    false,
  )
  assert.equal(hasPlannedChange({ resource_changes: [] }, address), false)
})

test('normalizes Terraform Go durations to protobuf JSON durations', () => {
  assert.equal(normalizeExecutionTimeout('5m0s'), '300s')
  assert.equal(normalizeExecutionTimeout('1m30.5s'), '90.5s')
  assert.equal(normalizeExecutionTimeout('500ms'), '0.5s')
  assert.equal(normalizeExecutionTimeout('30s'), '30s')
})

test('rejects invalid or over-precise execution timeouts', () => {
  assert.throws(() => normalizeExecutionTimeout('300'), /positive Go duration/)
  assert.throws(() => normalizeExecutionTimeout('1.5ns'), /sub-nanosecond/)
})

test('rejects a plan without a known container id', () => {
  assert.throws(
    () => buildDeployRevisionRequest({ ...values, id: null }),
    /container id must be a non-empty string/,
  )
})

test('rejects invalid resource numbers before calling the API', () => {
  assert.throws(
    () => buildDeployRevisionRequest({ ...values, memory: null }),
    /memory must be a non-negative integer/,
  )
})

test('reports the failed API operation and safe request identifier', () => {
  const headers = new Headers({ 'x-request-id': 'request-123' })
  assert.equal(
    formatYandexCloudApiError({
      operation: 'DeployRevision request',
      status: 403,
      body: { code: 7, message: 'Permission denied' },
      headers,
    }),
    'Yandex Cloud DeployRevision request returned HTTP 403: Permission denied '
      + '(code: 7, request ID: request-123) Verify that the deploy service '
      + 'account has an explicit iam.serviceAccounts.user role on the stage '
      + 'folder; if it does, contact Yandex Cloud support with the request ID.',
  )
})

test('retries transient transport failures with bounded backoff', async () => {
  let calls = 0
  const delays = []
  const result = await requestJson(
    'https://example.test/deploy',
    'secret-token',
    { method: 'POST', body: '{}' },
    'DeployRevision request',
    {
      fetchImpl: async () => {
        calls += 1
        if (calls < 3) throw new TypeError('fetch failed')
        return new Response(JSON.stringify({ id: 'operation-id' }))
      },
      sleep: async (delay) => { delays.push(delay) },
    },
  )

  assert.deepEqual(result, { id: 'operation-id' })
  assert.equal(calls, 3)
  assert.deepEqual(delays, [500, 1_000])
})

test('retries rate limits and server errors', async () => {
  let calls = 0
  const result = await requestJson(
    'https://example.test/operation',
    'token',
    {},
    'operation poll',
    {
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) {
          return new Response(JSON.stringify({ message: 'Unavailable' }), { status: 503 })
        }
        return new Response(JSON.stringify({ done: true }))
      },
      sleep: async () => {},
    },
  )

  assert.deepEqual(result, { done: true })
  assert.equal(calls, 2)
})

test('does not retry authorization or invalid request failures', async () => {
  let calls = 0
  await assert.rejects(
    requestJson(
      'https://example.test/deploy',
      'secret-token',
      {},
      'DeployRevision request',
      {
        fetchImpl: async () => {
          calls += 1
          return new Response(
            JSON.stringify({ message: 'Permission denied' }),
            { status: 403 },
          )
        },
        sleep: async () => {},
      },
    ),
    /returned HTTP 403: Permission denied/u,
  )
  assert.equal(calls, 1)
})

test('stops after the configured number of transient failures without exposing token', async () => {
  let calls = 0
  let caught
  try {
    await requestJson(
      'https://example.test/deploy',
      'very-secret-token',
      {},
      'DeployRevision request',
      {
        fetchImpl: async () => {
          calls += 1
          throw new TypeError('fetch failed')
        },
        sleep: async () => {},
        maxAttempts: 2,
      },
    )
  } catch (error) {
    caught = error
  }

  assert.equal(calls, 2)
  assert.match(caught?.message ?? '', /failed before receiving a response: fetch failed/u)
  assert.doesNotMatch(caught?.message ?? '', /very-secret-token/u)
})
