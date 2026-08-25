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
const vercelConfig = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'vercel.json'), 'utf8'),
)
const databaseAccessWorkflow = readFileSync(
  join(
    import.meta.dirname,
    '..',
    '.github',
    'workflows',
    'manage-yandex-stage-database-access.yml',
  ),
  'utf8',
)
const containerTerraform = readFileSync(
  join(import.meta.dirname, '..', 'infra', 'yandex', 'container.tf'),
  'utf8',
)
const variablesTerraform = readFileSync(
  join(import.meta.dirname, '..', 'infra', 'yandex', 'variables.tf'),
  'utf8',
)

test('publishes the final yandex-stage result without restoring an approval gate', () => {
  assert.match(workflow, /^  publish_deployment:$/m)
  assert.match(
    workflow,
    /^  publish_deployment:[\s\S]*?^    permissions:\n      deployments: write$/m,
  )
  assert.match(
    workflow,
    /^    if: always\(\) && github\.ref == 'refs\/heads\/main' && inputs\.plan_only != true$/m,
  )
  assert.match(workflow, /DEPLOY_RESULT: \$\{\{ needs\.deploy\.result \}\}/)
  assert.match(workflow, /required_contexts: \[\]/)
  assert.match(workflow, /transient_environment: false/)
  assert.match(workflow, /state: succeeded \? 'success' : 'error'/)
  assert.doesNotMatch(workflow, /^    environment: yandex-stage$/m)
})

test('preserves the deployed stage API timeout unless a cost change is reviewed', () => {
  assert.match(workflow, /^  TF_VAR_api_execution_timeout: '30s'$/m)
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
  assert.match(workflow, /--request POST[\s\S]*?\/v1\/clients/)
  assert.match(workflow, /\/v1\/clients\/\$domain_client_id\/preferences/)
  assert.match(workflow, /\/v1\/clients\/\$domain_client_id\/archive/)
  assert.match(workflow, /\/v1\/clients\?archived=true/)
  assert.match(workflow, /\.client\.version' <<<"\$domain_client_restored"/)
  assert.match(workflow, /test "\$domain_client_stale_status" = 409/)
  assert.match(workflow, /--request POST[\s\S]*?\/v1\/custom-exercises/)
  assert.match(workflow, /\/v1\/custom-exercises\/\$domain_exercise_id\/archive/)
  assert.match(workflow, /\.exercise\.version' <<<"\$domain_exercise_restored"/)
  assert.match(workflow, /test "\$domain_exercise_stale_status" = 409/)
  assert.match(workflow, /--request POST[\s\S]*?\/v1\/workouts/)
  assert.match(workflow, /--request PUT[\s\S]*?\/v1\/workouts\/\$workout_id/)
  assert.match(workflow, /Синтетическая проверка versioned mutation updated/)
  assert.match(workflow, /\.plan\.weightKg == 40 and \.plan\.reps == 10/)
  assert.match(workflow, /test "\$stale_status" = 409/)
  assert.match(workflow, /--request DELETE[\s\S]*?\/v1\/workouts\/\$workout_id/)
  assert.match(workflow, /all\(\.workouts\[\]; \.id != \$workout_id\)/)
  assert.match(workflow, /\/v1\/workouts\/\$live_workout_id\/start/)
  assert.match(workflow, /\.workout\.replayed == true/)
  assert.match(workflow, /\/v1\/workouts\/\$live_workout_id\/exercises/)
  assert.match(workflow, /\/v1\/workout-exercises\/\$live_exercise_id\/sets/)
  assert.match(workflow, /\/v1\/workout-sets\/\$appended_set_id/)
  assert.match(workflow, /\.set\.version == 5 and \.set\.replayed == true/)
  assert.match(
    workflow,
    /\/v1\/workouts\/\$live_workout_id\/exercises\/\$live_exercise_id/,
  )
  assert.match(workflow, /\/v1\/workout-exercises\/\$live_exercise_id\/comment/)
  assert.match(
    workflow,
    /\/v1\/workouts\/\$live_workout_id\/blocks\/\$appended_block_id\/reorder/,
  )
  assert.match(workflow, /\.block\.version == 8/)
  assert.match(workflow, /\/v1\/workout-sets\/\$live_set_id\/draft/)
  assert.match(workflow, /\.set\.replayed == true/)
  assert.match(workflow, /\/v1\/workout-sets\/\$live_set_id\/confirm/)
  assert.match(workflow, /\/v1\/workouts\/\$live_workout_id\/finish/)
  assert.match(workflow, /test "\$stale_finish_status" = 409/)
  assert.match(workflow, /\.status == "done"/)
  assert.match(workflow, /\.version == 9/)
  assert.match(workflow, /\.trainerComment == "Держи спину прямо"/)
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

test('deploys Vercel only from main and the stable Yandex preview branch, including slash branches', () => {
  assert.deepEqual(vercelConfig.git?.deploymentEnabled, {
    main: true,
    'codex/yandex-id-stage-pilot': true,
    '**': false,
  })
})

test('manages curated database readers only through an explicit private run', () => {
  assert.match(databaseAccessWorkflow, /^  workflow_dispatch:$/m)
  assert.doesNotMatch(databaseAccessWorkflow, /^  (?:push|pull_request):$/m)
  assert.match(databaseAccessWorkflow, /^  id-token: write$/m)
  assert.match(databaseAccessWorkflow, /^  group: yandex-stage$/m)
  assert.match(databaseAccessWorkflow, /scripts\/yandex-github-oidc\.sh/)
  assert.match(databaseAccessWorkflow, /GITHUB_REF.*refs\/heads\/main/)
  assert.match(
    databaseAccessWorkflow,
    /Authorization: Bearer \$YC_TOKEN/,
  )
  assert.match(
    databaseAccessWorkflow,
    /\/stage\/database-access\/readers/,
  )
  assert.match(databaseAccessWorkflow, /access_granted/)
  assert.match(databaseAccessWorkflow, /access_revoked/)
  assert.doesNotMatch(databaseAccessWorkflow, /terraform apply/)
  assert.doesNotMatch(databaseAccessWorkflow, /^    environment:/m)
  assert.doesNotMatch(databaseAccessWorkflow, /fit_api|mdb_read_all_data/)
})

test('supports a plan-only stage diagnostic that cannot deploy resources', () => {
  assert.match(
    workflow,
    /plan_only:\n\s+description: 'Create and validate the Terraform plan without applying it'/,
  )
  assert.equal(
    [...workflow.matchAll(/inputs\.plan_only != true/g)].length,
    2,
  )
})

test('keeps the legacy bridge pair validation compatible with Terraform 1.8', () => {
  assert.match(
    containerTerraform,
    /lifecycle \{[\s\S]*?precondition \{[\s\S]*?legacy_supabase_bridge_lockbox_secret_id[\s\S]*?legacy_supabase_bridge_lockbox_secret_version_id/,
  )
  assert.doesNotMatch(
    variablesTerraform,
    /variable "legacy_supabase_bridge_lockbox_secret_version_id" \{[\s\S]*?validation \{[\s\S]*?legacy_supabase_bridge_lockbox_secret_id/,
  )
})
