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
