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
        address: 'yandex_serverless_container_iam_binding.api_invocation',
        change: {
          actions: ['create'],
          after: { members: ['system:allUsers'] },
        },
      },
    ])

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /Public API invocation is outside the stage deployment workflow/,
    )
  })
})
