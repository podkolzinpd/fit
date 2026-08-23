import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'deploy-yandex-stage.yml'),
  'utf8',
)
const previewSyncWorkflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'sync-yandex-stage-preview.yml'),
  'utf8',
)

test('publishes the final yandex-stage result without restoring an approval gate', () => {
  assert.match(workflow, /^  publish_deployment:$/m)
  assert.match(
    workflow,
    /^  publish_deployment:[\s\S]*?^    permissions:\n      deployments: write$/m,
  )
  assert.match(workflow, /^    if: always\(\) && github\.ref == 'refs\/heads\/main'$/m)
  assert.match(workflow, /DEPLOY_RESULT: \$\{\{ needs\.deploy\.result \}\}/)
  assert.match(workflow, /required_contexts: \[\]/)
  assert.match(workflow, /transient_environment: false/)
  assert.match(workflow, /state: succeeded \? 'success' : 'error'/)
  assert.doesNotMatch(workflow, /^    environment: yandex-stage$/m)
})

test('loads synthetic fixtures and verifies every read model through the runtime API', () => {
  const migrationIndex = workflow.indexOf('- name: Apply all pending migrations')
  const fixtureIndex = workflow.indexOf('- name: Prepare idempotent stage workout fixture')
  const deployIndex = workflow.indexOf('- name: Deploy the API revision')
  const readinessIndex = workflow.indexOf('- name: Verify API health and readiness')

  assert.ok(migrationIndex >= 0)
  assert.ok(fixtureIndex > migrationIndex)
  assert.ok(deployIndex > fixtureIndex)
  assert.ok(readinessIndex > deployIndex)
  assert.match(workflow, /\/stage\/fixtures\/workout-read-model/)
  assert.match(workflow, /chmod 600 stage-workout-fixture-response\.json/)
  assert.match(workflow, /X-Fit-Pilot-Session: \$fixture_token/)
  assert.match(workflow, /\/v1\/clients/)
  assert.match(workflow, /Тестовый клиент Yandex stage/)
  assert.match(workflow, /\/v1\/connections/)
  assert.match(workflow, /\.memberships \| any\(\.isRoot == true\)/)
  assert.match(workflow, /\/v1\/training-data/)
  assert.match(workflow, /\.accessMode == "read_only"/)
  assert.match(workflow, /\.workoutDate == "2026-08-22"/)
  assert.match(workflow, /--request POST[\s\S]*?\/v1\/workouts/)
  assert.match(workflow, /--request PUT[\s\S]*?\/v1\/workouts\/\$workout_id/)
  assert.match(workflow, /Синтетическая проверка versioned mutation updated/)
  assert.match(workflow, /\.plan\.weightKg == 40 and \.plan\.reps == 10/)
  assert.match(workflow, /test "\$stale_status" = 409/)
  assert.match(workflow, /--request DELETE[\s\S]*?\/v1\/workouts\/\$workout_id/)
  assert.match(workflow, /all\(\.workouts\[\]; \.id != \$workout_id\)/)
  assert.match(workflow, /\/v1\/workouts\/\$live_workout_id\/start/)
  assert.match(workflow, /\.workout\.replayed == true/)
  assert.match(workflow, /\/v1\/workout-sets\/\$live_set_id\/draft/)
  assert.match(workflow, /\.set\.replayed == true/)
  assert.match(workflow, /\/v1\/workout-sets\/\$live_set_id\/confirm/)
  assert.match(workflow, /\/v1\/workouts\/\$live_workout_id\/finish/)
  assert.match(workflow, /test "\$stale_finish_status" = 409/)
  assert.match(workflow, /\.status == "done"/)
  assert.match(workflow, /\.confirmedAt != null/)
  assert.doesNotMatch(workflow, /jq -r '\.session\.token'/)
})

test('syncs the stable Yandex preview from main without rewriting history', () => {
  assert.match(previewSyncWorkflow, /^  push:\n    branches: \[main\]$/m)
  assert.match(previewSyncWorkflow, /^  contents: write$/m)
  assert.match(
    previewSyncWorkflow,
    /^  STAGE_PREVIEW_BRANCH: codex\/yandex-id-stage-pilot$/m,
  )
  assert.match(previewSyncWorkflow, /git merge --no-edit origin\/main/)
  assert.match(previewSyncWorkflow, /git push origin "HEAD:\$STAGE_PREVIEW_BRANCH"/)
  assert.doesNotMatch(previewSyncWorkflow, /--force(?:-with-lease)?/)
})
