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
const prPreviewWorkflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'deploy-pr-preview.yml'),
  'utf8',
)
const prPreviewCleanupWorkflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'cleanup-pr-preview.yml'),
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
const databaseTerraform = readFileSync(
  join(import.meta.dirname, '..', 'infra', 'yandex', 'database.tf'),
  'utf8',
)
const registryTerraform = readFileSync(
  join(import.meta.dirname, '..', 'infra', 'yandex', 'registry.tf'),
  'utf8',
)
const pushTerraform = readFileSync(
  join(import.meta.dirname, '..', 'infra', 'yandex', 'push.tf'),
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

test('keeps enough time for the bounded three-attempt summary contract', () => {
  assert.match(workflow, /^  TF_VAR_api_execution_timeout: '120s'$/m)
})

test('bootstraps the private push timer only after explicit cost approval and health', () => {
  assert.match(workflow, /^      approve_push_pipeline:$/m)
  assert.match(workflow, /^        default: false$/m)
  assert.match(
    workflow,
    /PUSH_PIPELINE_PLAN_REVIEWED: \$\{\{ \(inputs\.plan_only == true \|\| inputs\.approve_push_pipeline == true\)/,
  )
  assert.match(workflow, /policy_args\+=\(--allow-push-pipeline-bootstrap\)/)
  assert.match(workflow, /YC_PUSH_FOLDER_ID: \$\{\{ vars\.YC_SUMMARY_FOLDER_ID \}\}/)
  assert.match(workflow, /^  YC_STAGE_PUSH_LOCKBOX_NAME: fit-stage-push-transport$/m)
  assert.match(workflow, /TF_VAR_push_function_id=\$function_id/)
  assert.match(workflow, /TF_VAR_push_transport_secret_version_id=/)
  assert.match(
    workflow,
    /lockbox payload get[\s\S]*?--key PUSH_DISPATCH_SECRET[\s\S]*?echo "::add-mask::\$dispatch_secret"/,
  )
  assert.match(
    workflow,
    /Mirror the push transport payload into stage Lockbox[\s\S]*?mirror-yandex-push-transport\.mjs[\s\S]*?--source-version-id "\$PUSH_SOURCE_SECRET_VERSION_ID"/,
  )
  assert.match(
    readFileSync(join(import.meta.dirname, 'mirror-yandex-push-transport.mjs'), 'utf8'),
    /--deletion-protection[\s\S]*?--version-description[\s\S]*?--payload', '-'/,
  )
  assert.doesNotMatch(
    workflow,
    /PUSH_DISPATCH_SECRET=.*>> "\$GITHUB_ENV"/,
  )
  assert.match(
    workflow,
    /-target=yandex_lockbox_secret_iam_member\.push_dispatcher_transport_secret_reader/,
  )

  const deployIndex = workflow.indexOf(
    '- name: Deploy and verify the private push dispatcher',
  )
  const finalApplyIndex = workflow.indexOf(
    'terraform apply -auto-approve stage-post-revision.tfplan',
  )
  assert.ok(deployIndex >= 0)
  assert.ok(finalApplyIndex > deployIndex)
  assert.match(
    workflow,
    /-target=yandex_serverless_container\.push_dispatcher/,
  )
  assert.match(
    workflow,
    /Pin existing push runtime identities from Terraform state[\s\S]*?TF_VAR_push_dispatcher_registry_service_account_id/,
  )
  assert.match(
    workflow,
    /Pin new push runtime identities for subsequent Terraform plans[\s\S]*?TF_VAR_push_scheduler_invoker_service_account_id/,
  )
  assert.match(
    workflow,
    /-target=yandex_serverless_container_iam_binding\.push_dispatcher_invocation/,
  )
  assert.match(registryTerraform, /var\.push_dispatcher_registry_service_account_id/)
  assert.doesNotMatch(
    registryTerraform,
    /serviceAccount:\$\{yandex_iam_service_account\.push_dispatcher\.id\}/,
  )
  assert.match(pushTerraform, /var\.push_scheduler_invoker_service_account_id/)
  assert.doesNotMatch(
    pushTerraform,
    /serviceAccount:\$\{yandex_iam_service_account\.push_scheduler\.id\}/,
  )
  assert.match(workflow, /push-dispatcher-health\.json/)
  assert.match(workflow, /\.releaseId == \$release_id/)
  assert.match(workflow, /The first push dispatcher revision failed health; its timer was not created/)
  assert.match(
    workflow,
    /deploy-yandex-serverless-revision\.mjs rollback[\s\S]*?push_previous\.outputs\.revision_id/,
  )
})

test('reuses the private dispatcher for optional Telegram and Tracker delivery', () => {
  assert.match(
    workflow,
    /^  YC_APP_FEEDBACK_LOCKBOX_NAME: fit-stage-app-feedback-integrations$/m,
  )
  assert.match(
    workflow,
    /Resolve the optional app feedback integrations Lockbox version[\s\S]*?TF_VAR_app_feedback_integrations_secret_id=[\s\S]*?\.current_version\.id/,
  )
  assert.match(
    workflow,
    /-target=yandex_lockbox_secret_iam_member\.push_dispatcher_app_feedback_integrations_reader/,
  )
  assert.doesNotMatch(workflow, /-target=yandex_mdb_postgresql_user\.datalens/)
  assert.match(
    containerTerraform,
    /dynamic "secrets"[\s\S]*?APP_FEEDBACK_TELEGRAM_BOT_TOKEN[\s\S]*?APP_FEEDBACK_TRACKER_TOKEN/,
  )
  assert.match(
    databaseTerraform,
    /data_lens\s+= false/,
  )
  assert.doesNotMatch(
    databaseTerraform,
    /resource "yandex_mdb_postgresql_user" "datalens"/,
  )
  assert.match(
    variablesTerraform,
    /variable "app_feedback_integrations_secret_version_id"/,
  )
  assert.match(
    variablesTerraform,
    /var\.app_feedback_integrations_secret_id == null \? true : \([\s\S]*?trimspace\(var\.app_feedback_integrations_secret_id\)/,
  )
  assert.match(
    variablesTerraform,
    /var\.app_feedback_integrations_secret_version_id == null \? true : \([\s\S]*?trimspace\(var\.app_feedback_integrations_secret_version_id\)/,
  )
})

test('allows the API gateway and database readiness to settle before rollback', () => {
  assert.match(
    workflow,
    /bootstrap_deadline=\$\(\( \$\(date \+%s\) \+ 90 \)\)/,
  )
  assert.match(workflow, /api-health-response\.json/)
  assert.match(workflow, /\.releaseId == \$release_id/)
  assert.match(workflow, /observed release:/)
  assert.match(workflow, /api-readiness-response\.json/)
  assert.match(workflow, /API bootstrap did not reach release/)
  assert.ok(
    workflow.indexOf('"${api_url%/}/health"')
      < workflow.indexOf('"${api_url%/}/ready"'),
  )
  assert.doesNotMatch(
    workflow,
    /health=\$\(curl[\s\S]*?--retry 8[\s\S]*?\/health"\)/,
  )
})

test('probes the fit_api identity privately before changing the API revision', () => {
  const fixtureIndex = workflow.indexOf('- name: Prepare idempotent stage workout fixture')
  const preflightIndex = workflow.indexOf(
    '- name: Verify the API runtime database identity before deployment',
  )
  const deployIndex = workflow.indexOf('- name: Deploy the API revision')

  assert.ok(preflightIndex > fixtureIndex)
  assert.ok(deployIndex > preflightIndex)
  assert.match(workflow, /\/stage\/runtime-database\/readiness/)
  assert.match(workflow, /fixture_token=\$\(jq -er '\.session\.token'/)
  assert.match(workflow, /fixture_client_id=\$\(jq -er '\.session\.clientId'/)
  assert.match(workflow, /X-Fit-Pilot-Session: \$fixture_token/)
  assert.match(workflow, /X-Fit-Stage-Client-Id: \$fixture_client_id/)
  assert.match(workflow, /serialized progress bytes=/)
  assert.match(workflow, /Runtime database preflight failed: check=/)
  assert.match(workflow, /IN\("clients", "connections", "training-data", "progress"\)/)
  assert.match(workflow, /First clients smoke failed: HTTP/)
  assert.match(workflow, /Connections smoke failed: HTTP/)
  assert.match(
    workflow,
    /clients_status=\$\(curl[\s\S]*?\/v1\/clients"\) \|\| clients_curl_exit=\$\?/,
  )
  assert.match(
    workflow,
    /connections_status=\$\(curl[\s\S]*?\/v1\/connections"\) \|\| connections_curl_exit=\$\?/,
  )
  assert.match(workflow, /curl_exit=\$clients_curl_exit/)
  assert.match(workflow, /curl_exit=\$connections_curl_exit/)
  assert.match(workflow, /x-fit-error-category:/)
  assert.match(workflow, /x-fit-error-code:/)
  assert.match(workflow, /x-fit-release-id:/)
  assert.match(workflow, /toupper\(\$1\) ~ \/\^HTTP\\\//)
  assert.match(workflow, /candidate_streak=0/)
  assert.match(workflow, /candidate_streak=\$\(\( candidate_streak \+ 1 \)\)/)
  assert.match(workflow, /test "\$candidate_streak" -ge 5/)
  assert.match(workflow, /stage_smoke_headers=stage-smoke-last-headers\.txt/)
  assert.match(workflow, /command curl --dump-header "\$stage_smoke_headers" "\$@"/)
  assert.match(workflow, /trap report_stage_smoke_failure ERR/)
  assert.match(workflow, /Stage smoke failed: check=\$\{stage_smoke_check:-unknown\}/)
  assert.match(workflow, /command_exit=\$command_exit/)
  assert.match(workflow, /expected_release=\$API_IMAGE_TAG/)
  for (const check of [
    'training-data',
    'progress-bundle',
    'exercise-progress',
    'running-progress',
    'workout-chronicle',
    'training-summaries',
    'post-workout',
    'client-domain',
    'exercise-domain',
    'planned-workout-lifecycle',
    'completed-workout-lifecycle',
    'missed-workout-lifecycle',
    'assignment-results',
    'live-workout-lifecycle',
  ]) {
    assert.match(workflow, new RegExp(`stage_smoke_check=${check}`))
  }
  assert.match(workflow, /The API revision was not changed/)
  assert.match(
    workflow,
    /-target=yandex_lockbox_secret_iam_member\.migration_api_connection_secret_reader/,
  )
  assert.match(workflow, /--push-dispatcher-sa-id/)
  assert.match(workflow, /--push-scheduler-sa-id/)
  assert.match(containerTerraform, /STAGE_RUNTIME_DATABASE_PREFLIGHT_ENABLED/)
  assert.match(containerTerraform, /environment_variable = "DATABASE_PASSWORD"/)
  assert.match(
    databaseTerraform,
    /resource "yandex_lockbox_secret_iam_member" "migration_api_connection_secret_reader"/,
  )
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
  assert.match(
    workflow,
    /fixture_client_id=\$\(jq -er '\.session\.clientId' stage-workout-fixture-response\.json\)/,
  )
  assert.match(workflow, /\/v1\/clients/)
  assert.match(workflow, /Тестовый клиент Yandex stage/)
  assert.match(workflow, /\.id == \$fixture_client_id/)
  assert.match(workflow, /client_id="\$fixture_client_id"/)
  assert.doesNotMatch(
    workflow,
    /client_id=\$\(jq -er '[\s\S]*?select\(\.fullName == "Тестовый клиент Yandex stage"\)/,
  )
  assert.match(workflow, /\/v1\/connections/)
  assert.match(workflow, /\.memberships \| any\(\.isRoot == true\)/)
  assert.match(workflow, /\/v1\/training-data/)
  assert.match(workflow, /\/v1\/clients\/\$client_id\/progress/)
  assert.match(workflow, /\/v1\/clients\/\$client_id\/workout-chronicle/)
  assert.match(workflow, /\/v1\/clients\/\$client_id\/training-summaries/)
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

test('deploys Vercel only from main, stable stage, and explicit PR preview refs', () => {
  assert.deepEqual(vercelConfig.git?.deploymentEnabled, {
    main: true,
    'codex/yandex-id-stage-pilot': true,
    'preview/**': true,
    '**': false,
  })
})

test('creates isolated Vercel previews only when a collaborator requests their own PR', () => {
  assert.match(prPreviewWorkflow, /^  issue_comment:\n    types: \[created\]$/m)
  assert.match(prPreviewWorkflow, /^  contents: write$/m)
  assert.match(prPreviewWorkflow, /^  deployments: read$/m)
  assert.match(prPreviewWorkflow, /^  pull-requests: write$/m)
  assert.match(prPreviewWorkflow, /github\.event\.comment\.body == '\/preview'/)
  assert.match(prPreviewWorkflow, /OWNER.*MEMBER.*COLLABORATOR/)
  assert.match(prPreviewWorkflow, /'\.user\.login'/)
  assert.match(prPreviewWorkflow, /"\$author" != "\$REQUESTED_BY"/)
  assert.match(prPreviewWorkflow, /"\$state" != 'open' \|\| "\$base_ref" != 'main'/)
  assert.match(prPreviewWorkflow, /"\$head_repository" != "\$REPOSITORY"/)
  assert.match(prPreviewWorkflow, /preview_branch="preview\/pr-\$PR_NUMBER"/)
  assert.match(prPreviewWorkflow, /uses: actions\/checkout@v4/)
  assert.match(prPreviewWorkflow, /git commit --allow-empty/)
  assert.match(prPreviewWorkflow, /preview_tree.*source_tree/)
  assert.match(prPreviewWorkflow, /--force-with-lease=/)
  assert.match(prPreviewWorkflow, /repos\/\$REPOSITORY\/deployments/)
  assert.match(prPreviewWorkflow, /Vercel Preview готов/)
  assert.match(prPreviewWorkflow, /issues\/\$PR_NUMBER\/comments/)
  assert.doesNotMatch(
    prPreviewWorkflow,
    /^  pull_request(?:_target)?:|--method DELETE|VERCEL_TOKEN/m,
  )
})

test('cleans preview refs from the trusted base context after a PR closes', () => {
  assert.match(
    prPreviewCleanupWorkflow,
    /^  pull_request_target:\n    types: \[closed\]$/m,
  )
  assert.match(prPreviewCleanupWorkflow, /^  contents: write$/m)
  assert.match(
    prPreviewCleanupWorkflow,
    /group: pr-preview-\$\{\{ github\.event\.pull_request\.number \}\}/,
  )
  assert.match(
    prPreviewCleanupWorkflow,
    /preview_branch="preview\/pr-\$PR_NUMBER"/,
  )
  assert.match(prPreviewCleanupWorkflow, /--method DELETE/)
  assert.doesNotMatch(
    prPreviewCleanupWorkflow,
    /actions\/checkout|github\.event\.pull_request\.head|VERCEL_TOKEN/,
  )
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

test('validates feature branches without expanding the main-only Yandex OIDC trust', () => {
  const validateIndex = workflow.indexOf('name: Validate Terraform configuration')
  const planIndex = workflow.indexOf('name: Review Terraform plan')
  const oidcIndex = workflow.indexOf('name: Exchange OIDC token for the push transport identity')

  assert.ok(validateIndex >= 0)
  assert.ok(planIndex > validateIndex)
  assert.ok(oidcIndex > planIndex)
  assert.match(workflow, /name: Review Terraform plan[\s\S]*?if: github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /terraform init -backend=false/)
  assert.match(workflow, /name: Validate Terraform configuration[\s\S]*?terraform validate/)
  assert.doesNotMatch(
    workflow.slice(validateIndex, planIndex),
    /YC_TFSTATE_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)/,
  )
})

test('preserves reviewed WebSQL access instead of creating PostgreSQL drift', () => {
  assert.match(databaseTerraform, /^      web_sql\s+= true$/m)
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
