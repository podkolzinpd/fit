import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const repositoryRoot = join(import.meta.dirname, '..')
const workflow = readFileSync(
  join(repositoryRoot, '.github', 'workflows', 'provision-yandex-production.yml'),
  'utf8',
)
const database = readFileSync(
  join(repositoryRoot, 'infra', 'yandex', 'database.tf'),
  'utf8',
)
const variables = readFileSync(
  join(repositoryRoot, 'infra', 'yandex', 'variables.tf'),
  'utf8',
)

test('keeps production provisioning manual, isolated and explicitly confirmed', () => {
  assert.match(workflow, /^  workflow_dispatch:$/m)
  assert.doesNotMatch(workflow, /^  (push|pull_request):$/m)
  assert.match(workflow, /plan_only:[\s\S]*?default: true/)
  assert.match(
    workflow,
    /test "\$CONFIRMATION" = PROVISION_FIT_YANDEX_PRODUCTION/,
  )
  assert.match(workflow, /group: yandex-production-platform/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /-backend-config=key=fit\/prod\/terraform\.tfstate/)
  assert.match(workflow, /^  TF_VAR_environment: prod$/m)
})

test('uses the small single-host private PostgreSQL production profile', () => {
  assert.match(workflow, /^  TF_VAR_postgres_disk_size_gb: '20'$/m)
  assert.match(workflow, /^  TF_VAR_postgres_backup_retain_period_days: '14'$/m)
  assert.match(workflow, /^  TF_VAR_allow_unauthenticated_api: 'false'$/m)
  assert.match(workflow, /\.values\.hosts \| length\] == \[1\]/)
  assert.match(workflow, /all\(\.hosts\[\]; \.assign_public_ip == false\)/)
  assert.match(database, /backup_retain_period_days = var\.postgres_backup_retain_period_days/)
  assert.match(database, /backup_window_start = var\.postgres_backup_window_start/)
  assert.match(variables, /postgres_backup_retain_period_days[\s\S]*?between 7 and 60 days/)
  assert.doesNotMatch(workflow, /postgres_ha|replica_subnet|multi-zone/)
})

test('creates no public route and deploys only the existing API and migration runtimes', () => {
  assert.match(
    workflow,
    /-target=yandex_serverless_container\.api[\s\S]*?-target=yandex_serverless_container\.migration/,
  )
  assert.match(workflow, /terraform plan -out=production-runtime\.tfplan/)
  assert.match(
    workflow,
    /check-yandex-terraform-plan\.mjs production-runtime\.tfplan\.json/,
  )
  assert.match(
    workflow,
    /terraform apply -auto-approve production-runtime\.tfplan/,
  )
  assert.match(workflow, /\/migrate/)
  assert.match(workflow, /\/health/)
  assert.match(workflow, /\/ready/)
  assert.doesNotMatch(workflow, /system:allUsers/)
  assert.doesNotMatch(workflow, /push_dispatcher_timer|push-dispatcher/)
})
