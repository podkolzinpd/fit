import assert from 'node:assert/strict'
import test from 'node:test'

import {
  findMissingRuntimeBindings,
  hasServiceAccountUserBinding,
  listServiceAccountBindings,
  waitForRuntimeBindings,
} from './verify-yandex-stage-access.mjs'

const deployerId = 'deployer-sa'
const pushDispatcherId = 'push-dispatcher-sa'
const pushSchedulerId = 'push-scheduler-sa'
const runtimeBinding = {
  roleId: 'iam.serviceAccounts.user',
  subject: { type: 'serviceAccount', id: deployerId },
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

test('recognizes only the deployer service account user binding', () => {
  assert.equal(hasServiceAccountUserBinding([runtimeBinding], deployerId), true)
  assert.equal(
    hasServiceAccountUserBinding(
      [{ ...runtimeBinding, subject: { type: 'userAccount', id: deployerId } }],
      deployerId,
    ),
    false,
  )
})

test('reads every service account access-binding page', async () => {
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(String(url))
    return urls.length === 1
      ? response({ accessBindings: [], nextPageToken: 'next' })
      : response({ accessBindings: [runtimeBinding] })
  }

  const bindings = await listServiceAccountBindings({
    serviceAccountId: 'runtime-sa',
    token: 'token',
    fetchImpl,
  })

  assert.deepEqual(bindings, [runtimeBinding])
  assert.match(urls[1], /pageToken=next/u)
})

test('reports self-use separately from runtime attachment grants', async () => {
  const fetchImpl = async (url) =>
    response({
      accessBindings: String(url).includes(deployerId) ? [] : [runtimeBinding],
    })

  const missing = await findMissingRuntimeBindings({
    deployerServiceAccountId: deployerId,
    apiRuntimeServiceAccountId: 'api-sa',
    migrationRuntimeServiceAccountId: 'migration-sa',
    pushDispatcherServiceAccountId: pushDispatcherId,
    pushSchedulerServiceAccountId: pushSchedulerId,
    token: 'token',
    fetchImpl,
  })

  assert.deepEqual(missing, [`deployer itself (${deployerId})`])
})

test('waits for IAM propagation and then succeeds', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return response({ accessBindings: calls <= 5 ? [] : [runtimeBinding] })
  }

  await waitForRuntimeBindings({
    deployerServiceAccountId: deployerId,
    apiRuntimeServiceAccountId: 'api-sa',
    migrationRuntimeServiceAccountId: 'migration-sa',
    pushDispatcherServiceAccountId: pushDispatcherId,
    pushSchedulerServiceAccountId: pushSchedulerId,
    token: 'token',
    timeoutMs: 1_000,
    pollIntervalMs: 1,
    fetchImpl,
    sleep: async () => {},
  })

  assert.equal(calls, 10)
})

test('fails before image work when a required binding never appears', async () => {
  await assert.rejects(
    waitForRuntimeBindings({
      deployerServiceAccountId: deployerId,
      apiRuntimeServiceAccountId: 'api-sa',
      migrationRuntimeServiceAccountId: 'migration-sa',
      pushDispatcherServiceAccountId: pushDispatcherId,
      pushSchedulerServiceAccountId: pushSchedulerId,
      token: 'token',
      timeoutMs: 1,
      pollIntervalMs: 1,
      fetchImpl: async () => response({ accessBindings: [] }),
      sleep: async () => {},
    }),
    /Missing iam\.serviceAccounts\.user.*deployer itself.*API runtime.*migration runtime.*push dispatcher runtime.*push scheduler/u,
  )
})

test('does not retry an IAM API authorization error', async () => {
  let calls = 0
  await assert.rejects(
    waitForRuntimeBindings({
      deployerServiceAccountId: deployerId,
      apiRuntimeServiceAccountId: 'api-sa',
      migrationRuntimeServiceAccountId: 'migration-sa',
      pushDispatcherServiceAccountId: pushDispatcherId,
      pushSchedulerServiceAccountId: pushSchedulerId,
      token: 'token',
      timeoutMs: 1_000,
      pollIntervalMs: 1,
      fetchImpl: async () => {
        calls += 1
        return response({ message: 'Permission denied' }, 403)
      },
      sleep: async () => {},
    }),
    /Yandex IAM returned HTTP 403: Permission denied/u,
  )
  assert.equal(calls, 5)
})
