import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const repositoryRoot = join(import.meta.dirname, '..')
const workflow = readFileSync(
  join(
    repositoryRoot,
    '.github',
    'workflows',
    'rehearse-yandex-tenant-migration.yml',
  ),
  'utf8',
)
const container = readFileSync(
  join(repositoryRoot, 'infra', 'yandex', 'container.tf'),
  'utf8',
)

test('keeps tenant rehearsal manual and single-flight', () => {
  assert.match(workflow, /^  workflow_dispatch:$/m)
  assert.doesNotMatch(workflow, /^  (push|pull_request):$/m)
  assert.match(workflow, /options:\n\s+- audit\n\s+- dry-run\n\s+- apply/)
  assert.match(workflow, /group: yandex-tenant-migration/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.doesNotMatch(workflow, /environment:/)
})

test('keeps the selected profile masked and the encrypted bundle ephemeral', () => {
  assert.match(
    workflow,
    /FIT_TENANT_TRAINER_ID: \$\{\{ secrets\.FIT_TENANT_TRAINER_ID \}\}/g,
  )
  assert.doesNotMatch(workflow, /trainer_id:\n|--trainer-id/)
  assert.doesNotMatch(workflow, /actions\/upload-artifact|artifact\.fit/)
  assert.match(workflow, /tenant:rehearse:remote/g)
})

test('uses source-only permissions for audit and OIDC only for target access', () => {
  assert.match(
    workflow,
    /audit:[\s\S]*?permissions:\n\s+contents: read[\s\S]*?stage:/,
  )
  assert.match(
    workflow,
    /stage:[\s\S]*?permissions:\n\s+contents: read\n\s+id-token: write/,
  )
  assert.match(workflow, /supabase link[\s\S]*SUPABASE_DB_PASSWORD/)
  assert.match(workflow, /scripts\/yandex-github-oidc\.sh/)
  assert.match(workflow, /--name fit-stage-migration/)
})

test('requires independent apply confirmation and a private stage route', () => {
  assert.match(
    workflow,
    /test "\$APPLY_CONFIRMATION" = APPLY_TENANT_TO_YANDEX_STAGE/,
  )
  assert.match(
    container,
    /STAGE_TENANT_MIGRATION_ENABLED\s+= var\.environment == "stage" \? "true" : "false"/,
  )
  assert.doesNotMatch(workflow, /system:allUsers/)
})
