import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

const policyScript = join(import.meta.dirname, 'check-yandex-terraform-plan.mjs')

function runPolicy(resourceChanges, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fit-yandex-plan-policy-'))
  const planPath = join(directory, 'plan.json')
  writeFileSync(
    planPath,
    JSON.stringify({
      applyable: options.applyable ?? resourceChanges.length > 0,
      complete: true,
      errored: false,
      resource_changes: resourceChanges,
    }),
  )

  return spawnSync(
    process.execPath,
    [
      policyScript,
      planPath,
      ...(options.allowDestroy === true ? ['--allow-destroy'] : []),
      ...(options.allowPublicApi === true ? ['--allow-public-api'] : []),
      ...(options.automaticStageUpdate === true
        ? ['--automatic-stage-update']
        : []),
    ],
    { encoding: 'utf8' },
  )
}

describe('Yandex Terraform plan policy', () => {
  test('accepts a complete no-op plan on a release retry', () => {
    assert.equal(runPolicy([], { applyable: false }).status, 0)
  })

  test('accepts non-destructive changes', () => {
    const result = runPolicy([
      {
        address: 'yandex_serverless_container.api',
        change: { actions: ['update'] },
      },
    ])

    assert.equal(result.status, 0)
  })

  test('accepts an automatic API image update without a resource resize', () => {
    const result = runPolicy(
      [
        {
          address: 'yandex_serverless_container.api',
          change: {
            actions: ['update'],
            before: { memory: 1024, cores: 1, image: [{ url: 'old' }] },
            after: { memory: 1024, cores: 1, image: [{ url: 'new' }] },
          },
        },
      ],
      { automaticStageUpdate: true },
    )

    assert.equal(result.status, 0)
  })

  test('blocks an automatic paid resource creation', () => {
    const result = runPolicy(
      [
        {
          address: 'yandex_mdb_postgresql_cluster_v2.second',
          change: { actions: ['create'], after: {} },
        },
      ],
      { automaticStageUpdate: true },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /Automatic stage deploy contains new or cost-sensitive infrastructure changes/,
    )
  })

  test('blocks an automatic database resize', () => {
    const result = runPolicy(
      [
        {
          address: 'yandex_mdb_postgresql_cluster_v2.fit',
          change: { actions: ['update'], before: {}, after: {} },
        },
      ],
      { automaticStageUpdate: true },
    )

    assert.notEqual(result.status, 0)
  })

  test('blocks an automatic Serverless Container resize', () => {
    const result = runPolicy(
      [
        {
          address: 'yandex_serverless_container.api',
          change: {
            actions: ['update'],
            before: { memory: 1024, cores: 1 },
            after: { memory: 2048, cores: 1 },
          },
        },
      ],
      { automaticStageUpdate: true },
    )

    assert.notEqual(result.status, 0)
  })

  test('accepts bounded automatic image retention', () => {
    const result = runPolicy(
      [
        {
          address: 'yandex_container_repository_lifecycle_policy.api',
          change: {
            actions: ['update'],
            before: { rule: [] },
            after: {
              rule: [
                { expire_period: '168h', retained_top: 10, tagged: true },
                { expire_period: '168h', retained_top: 3, untagged: true },
              ],
            },
          },
        },
      ],
      { automaticStageUpdate: true },
    )

    assert.equal(result.status, 0)
  })

  test('blocks automatic image retention above the cost cap', () => {
    const result = runPolicy(
      [
        {
          address: 'yandex_container_repository_lifecycle_policy.api',
          change: {
            actions: ['update'],
            before: { rule: [] },
            after: {
              rule: [{ expire_period: '720h', retained_top: 100, tagged: true }],
            },
          },
        },
      ],
      { automaticStageUpdate: true },
    )

    assert.notEqual(result.status, 0)
  })

  test('accepts only Lockbox description metadata automatically', () => {
    const accepted = runPolicy(
      [
        {
          address: 'yandex_lockbox_secret.database_url',
          change: {
            actions: ['update'],
            before: { id: 'secret', description: 'old' },
            after: { id: 'secret', description: 'new' },
          },
        },
      ],
      { automaticStageUpdate: true },
    )
    const blocked = runPolicy(
      [
        {
          address: 'yandex_lockbox_secret.database_url',
          change: {
            actions: ['update'],
            before: { id: 'secret', deletion_protection: true },
            after: { id: 'secret', deletion_protection: false },
          },
        },
      ],
      { automaticStageUpdate: true },
    )

    assert.equal(accepted.status, 0)
    assert.notEqual(blocked.status, 0)
  })

  test('blocks database destruction even with the manual override', () => {
    const result = runPolicy(
      [
        {
          address: 'yandex_mdb_postgresql_cluster_v2.fit',
          change: { actions: ['delete', 'create'] },
        },
      ],
      { allowDestroy: true },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /Managed PostgreSQL cluster or database destruction is always blocked/,
    )
  })

  test('blocks public API invocation', () => {
    const result = runPolicy([
      {
        address: 'yandex_serverless_container_iam_binding.api_invocation[0]',
        change: {
          actions: ['create'],
          after: {
            members: ['system:allUsers'],
            role: 'serverless.containers.invoker',
          },
        },
      },
    ])

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /Public invocation is allowed only for the reviewed stage API binding/,
    )
  })

  test('allows only the exact stage API invocation binding with a review flag', () => {
    const result = runPolicy(
      [
        {
          address: 'yandex_serverless_container_iam_binding.api_invocation[0]',
          change: {
            actions: ['create'],
            after: {
              members: ['serviceAccount:deployer', 'system:allUsers'],
              role: 'serverless.containers.invoker',
            },
          },
        },
      ],
      { allowPublicApi: true },
    )

    assert.equal(result.status, 0)
  })

  test('allows the exact public stage API binding in automatic mode', () => {
    const result = runPolicy(
      [
        {
          address: 'yandex_serverless_container_iam_binding.api_invocation[0]',
          change: {
            actions: ['create'],
            after: {
              members: ['serviceAccount:deployer', 'system:allUsers'],
              role: 'serverless.containers.invoker',
            },
          },
        },
      ],
      { allowPublicApi: true, automaticStageUpdate: true },
    )

    assert.equal(result.status, 0)
  })

  test('keeps the migration runner private even with the API review flag', () => {
    const result = runPolicy(
      [
        {
          address:
            'yandex_serverless_container_iam_binding.migration_invocation[0]',
          change: {
            actions: ['update'],
            after: {
              members: ['system:allUsers'],
              role: 'serverless.containers.invoker',
            },
          },
        },
      ],
      { allowPublicApi: true },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /Public invocation is allowed only for the reviewed stage API binding/,
    )
  })

  test('blocks a public API binding with an unexpected role', () => {
    const result = runPolicy(
      [
        {
          address: 'yandex_serverless_container_iam_binding.api_invocation[0]',
          change: {
            actions: ['update'],
            after: { members: ['system:allUsers'], role: 'editor' },
          },
        },
      ],
      { allowPublicApi: true },
    )

    assert.notEqual(result.status, 0)
  })

  test('blocks a singular public IAM member on every other resource', () => {
    const result = runPolicy(
      [
        {
          address: 'yandex_storage_bucket_iam_member.unexpected',
          change: {
            actions: ['create'],
            after: { member: 'system:allUsers', role: 'storage.viewer' },
          },
        },
      ],
      { allowPublicApi: true },
    )

    assert.notEqual(result.status, 0)
  })
})
