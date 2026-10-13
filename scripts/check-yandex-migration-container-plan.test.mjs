import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const script = join(import.meta.dirname, 'check-yandex-migration-container-plan.mjs')
const tag = 'a'.repeat(40)
const containerAddress = 'yandex_serverless_container.migration[0]'
const bindingAddress = 'yandex_serverless_container_iam_binding.migration_invocation[0]'

function plan(changes = []) {
  const container = {
    address: containerAddress,
    values: {
      concurrency: 1, execution_timeout: '300s', memory: 512, cores: 1,
      core_fraction: 100,
      image: [{ url: `cr.yandex/test:${tag}`, command: ['node', 'dist/migration-server.js'], environment: { APP_ENV: 'stage' } }],
    },
  }
  const binding = {
    address: bindingAddress,
    values: { role: 'serverless.containers.invoker', members: ['serviceAccount:deployer'] },
  }
  return { complete: true, applyable: true, resource_changes: changes, planned_values: { root_module: { resources: [container, binding] } } }
}

function check(value) {
  const directory = mkdtempSync(join(tmpdir(), 'fit-migration-plan-'))
  const path = join(directory, 'plan.json')
  try {
    writeFileSync(path, JSON.stringify(value))
    return execFileSync(process.execPath, [script, '--plan', path, '--image-tag', tag, '--image-repository', 'cr.yandex/test'], { encoding: 'utf8' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('accepts a no-op or private in-place migration revision plan', () => {
  assert.match(check(plan()), /Changed resources: 0/)
  const change = { address: containerAddress, change: { actions: ['update'] } }
  assert.match(check(plan([change])), /Changed resources: 1/)
  assert.match(check({ ...plan([change]), complete: false }), /Changed resources: 1/)
})

test('rejects an invalid or non-applyable targeted plan', () => {
  assert.throws(() => check({ ...plan(), complete: undefined }), /valid and applyable/)
  assert.throws(() => check({ ...plan(), complete: false, applyable: false }), /valid and applyable/)
  assert.throws(() => check({ ...plan(), complete: false, errored: true }), /valid and applyable/)
})

test('rejects trigger changes, binding drift and deletion', () => {
  const failure = (change) => assert.throws(() => check(plan([change])), /unexpected resources|binding drift|must not delete|beyond the image revision/)
  failure({ address: 'yandex_function_trigger.api_warmup_timer', change: { actions: ['update'] } })
  failure({ address: bindingAddress, change: { actions: ['update'] } })
  failure({ address: containerAddress, change: { actions: ['delete'] } })
  failure({
    address: containerAddress,
    change: {
      actions: ['update'],
      before: { service_account_id: 'migration-runtime', image: [{ url: 'cr.yandex/test:old' }] },
      after: { service_account_id: 'other-runtime', image: [{ url: `cr.yandex/test:${tag}` }] },
    },
  })
})
