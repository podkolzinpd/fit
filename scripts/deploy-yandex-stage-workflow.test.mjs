import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { SMOKE_BUDGET_MS, runSmokeRequest, safeRequestMetadata, verifyFixtureBudget } from './yandex-stage-smoke.mjs'

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'deploy-yandex-stage.yml'),
  'utf8',
)
test('coach workout identity inspection is manual, read-only and fixed-cohort', () => {
  const source = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'inspect-coach-workout-pilot.yml'), 'utf8')
  assert.match(source, /workflow_dispatch:/)
  assert.match(source, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(source, /\/stage\/experiments\/coach-workout-pilot/)
  assert.match(source, /profileIds \| length == 2/)
  assert.match(source, /profileIds \| unique \| length == 2/)
  assert.match(source, /coach-workout-readback\.json/)
  assert.doesNotMatch(source, /--request POST|--data|terraform apply|TARGET_EMAIL|SUPABASE|psql/)
  const frontend = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'deploy-yandex-frontend.yml'), 'utf8')
  assert.match(frontend, /VITE_COACH_WORKOUT_REDESIGN_ENABLED:.*\|\| 'false'/)
  assert.match(frontend, /VITE_COACH_WORKOUT_REDESIGN_PILOT_USER_IDS:.*\|\| ''/)
})
const trainerSchedulePilotWorkflow = readFileSync(
  join(
    import.meta.dirname,
    '..',
    '.github',
    'workflows',
    'manage-trainer-schedule-v2-pilot.yml',
  ),
  'utf8',
)
const oidcExchangeScript = readFileSync(
  join(import.meta.dirname, 'yandex-github-oidc.sh'),
  'utf8',
)
const availabilityVerifier = readFileSync(
  join(import.meta.dirname, 'verify-yandex-api-availability.mjs'),
  'utf8',
)
const smokeVerifier = readFileSync(join(import.meta.dirname, 'yandex-stage-smoke.mjs'), 'utf8')

test('configures a fresh ephemeral Yandex CLI profile after every OIDC exchange', () => {
  assert.match(oidcExchangeScript, /if command -v yc >\/dev\/null 2>&1/)
  assert.match(
    oidcExchangeScript,
    /profile_name="github-actions-\$\{GITHUB_RUN_ID:-local\}-\$\{GITHUB_JOB:-job\}-\$\{RANDOM\}"/,
  )
  assert.match(oidcExchangeScript, /yc config profile create "\$profile_name"/)
  assert.match(
    oidcExchangeScript,
    /yc config set endpoint "\$\{YC_CLOUD_API_ENDPOINT:-api\.cloud\.yandex\.net:443\}"/,
  )
  assert.match(oidcExchangeScript, /yc config set token "\$iam_token"/)
  assert.match(oidcExchangeScript, /yc config set folder-id "\$YC_FOLDER_ID"/)
  assert.doesNotMatch(workflow, /yc config profile create|yc config set token/)
})

test('keeps the trainer Schedule V2 rollout bounded while preserving two assignments', () => {
  assert.match(trainerSchedulePilotWorkflow, /test "\$GITHUB_REF" = 'refs\/heads\/main'/)
  assert.match(
    trainerSchedulePilotWorkflow,
    /TARGET_EMAIL: \$\{\{ secrets\.FIT_TRAINER_SCHEDULE_V2_TARGET_EMAIL \}\}/,
  )
  assert.match(trainerSchedulePilotWorkflow, /ENABLE_ONE_TRAINER_SCHEDULE_V2/)
  assert.match(trainerSchedulePilotWorkflow, /DISABLE_ONE_TRAINER_SCHEDULE_V2/)
  assert.match(trainerSchedulePilotWorkflow, /target_account_not_unique/)
  assert.match(trainerSchedulePilotWorkflow, /manage_trainer_schedule_v2_pilot/)
  assert.match(trainerSchedulePilotWorkflow, /Supabase pilot manager returned HTTP \$status/)
  assert.match(trainerSchedulePilotWorkflow, /if test "\$status" = 409/)
  assert.match(trainerSchedulePilotWorkflow, /\.enabledAssignments >= 1 and \.enabledAssignments <= 2/)
  assert.match(trainerSchedulePilotWorkflow, /\.enabledAssignments >= 0 and \.enabledAssignments <= 1/)
  assert.doesNotMatch(trainerSchedulePilotWorkflow, /knyaz187@/i)
  assert.doesNotMatch(trainerSchedulePilotWorkflow, /echo.*TARGET_EMAIL/)
})
const vercelConfig = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'vercel.json'), 'utf8'),
)
const startupHtml = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8')
const assetRecoveryScript = readFileSync(
  join(import.meta.dirname, '..', 'public', 'asset-recovery.js'),
  'utf8',
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
const rolloutWorkflow = readFileSync(
  join(
    import.meta.dirname,
    '..',
    '.github',
    'workflows',
    'manage-yandex-stage-rollout.yml',
  ),
  'utf8',
)
const identityUnlinkWorkflow = readFileSync(
  join(
    import.meta.dirname,
    '..',
    '.github',
    'workflows',
    'manage-yandex-stage-identity-unlink.yml',
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
const networkTerraform = readFileSync(
  join(import.meta.dirname, '..', 'infra', 'yandex', 'network.tf'),
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
const warmupTerraform = readFileSync(
  join(import.meta.dirname, '..', 'infra', 'yandex', 'warmup.tf'),
  'utf8',
)
const mediaTerraform = readFileSync(
  join(import.meta.dirname, '..', 'infra', 'yandex', 'media.tf'),
  'utf8',
)
const mediaMigrationWorkflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'migrate-yandex-media.yml'),
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

test('combines complete VPC zone coverage with one provisioned API instance', () => {
  assert.match(workflow, /^  TF_VAR_api_min_instances: '1'$/m)
  assert.match(
    containerTerraform,
    /provision_policy \{\s+min_instances = var\.api_min_instances\s+\}/,
  )
  assert.match(variablesTerraform, /variable "api_min_instances"/)
  assert.doesNotMatch(pushTerraform, /provision_policy/)
  for (const zone of ['ru-central1-a', 'ru-central1-b', 'ru-central1-e']) {
    assert.match(networkTerraform, new RegExp(`"${zone}"\\s*=\\s*"10\\.42\\.`))
  }
})

test('keeps the provisioned API active with a bounded side-effect-free timer', () => {
  assert.match(warmupTerraform, /cron_expression\s+= "\* \* \* \* \? \*"/)
  assert.match(warmupTerraform, /path\s+= "\/internal\/warmup"/)
  assert.match(warmupTerraform, /retry_attempts\s+= 2/)
  assert.match(warmupTerraform, /retry_interval\s+= 10/)
  assert.match(
    workflow,
    /-target=yandex_iam_service_account_iam_member\.api_warmer_deployer/,
  )
  assert.match(
    workflow,
    /--api-warmer-sa-id "\$\(terraform output -raw api_warmer_service_account_id\)"/,
  )
})

test('hardens backups on the existing database without provisioning a second stack', () => {
  assert.match(
    workflow,
    /^  TF_VAR_postgres_backup_retain_period_days: '14'$/m,
  )
  assert.match(
    workflow,
    /^  TF_VAR_postgres_backup_window_start: '\{"hours":0,"minutes":30\}'$/m,
  )
  assert.match(workflow, /key=fit\/stage\/terraform\.tfstate/)
  assert.doesNotMatch(workflow, /fit\/prod\/terraform\.tfstate/)
  assert.match(
    databaseTerraform,
    /backup_window_start\s+= var\.postgres_backup_window_start/,
  )
  assert.doesNotMatch(databaseTerraform, /dynamic "backup_window_start"/)
})

test('allows the reviewed local, Android, iOS, preview, and production frontend origins', () => {
  assert.match(
    workflow,
    /^  TF_VAR_api_cors_allowed_origins: '\["http:\/\/localhost:5173","https:\/\/localhost","capacitor:\/\/localhost","https:\/\/fit-git-codex-yandex-id-b494d5-uniteddispatch999-8643s-projects\.vercel\.app","https:\/\/fit-drab\.vercel\.app","https:\/\/d5drmhq5ovqk03jgsm8i\.wnq2w1o5\.apigw\.yandexcloud\.net","https:\/\/fit-training\.ru"\]'$/m,
  )
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

test('bootstraps private media only after cost approval and keeps migration aggregate-only', () => {
  assert.match(workflow, /^      approve_media_storage:$/m)
  assert.ok(workflow.includes(
    'MEDIA_STORAGE_PLAN_REVIEWED: ${{ (inputs.plan_only == true || inputs.approve_media_storage == true)',
  ))
  assert.equal(
    [...workflow.matchAll(/policy_args\+=\(--allow-media-storage-bootstrap\)/g)].length,
    3,
  )
  assert.match(workflow, /-target=yandex_storage_bucket\.media/)
  assert.match(
    workflow,
    /-target=yandex_iam_service_account_static_access_key\.api_media/,
  )
  assert.match(mediaTerraform, /anonymous_access_flags \{[\s\S]*?read\s+= false[\s\S]*?list\s+= false/)
  assert.match(mediaTerraform, /versioning \{\s+enabled = true/)
  assert.match(mediaTerraform, /force_destroy\s+= false/)
  assert.match(
    mediaTerraform,
    /output_to_lockbox \{[\s\S]*?entry_for_access_key = "YANDEX_MEDIA_ACCESS_KEY_ID"[\s\S]*?entry_for_secret_key = "YANDEX_MEDIA_SECRET_ACCESS_KEY"/,
  )
  assert.match(mediaMigrationWorkflow, /^  workflow_dispatch:$/m)
  assert.doesNotMatch(mediaMigrationWorkflow, /^  (push|pull_request):$/m)
  assert.match(mediaMigrationWorkflow, /supabase projects api-keys/)
  assert.match(mediaMigrationWorkflow, /echo "::add-mask::\$source_key"/)
  assert.match(
    mediaMigrationWorkflow,
    /^  YANDEX_MEDIA_BUCKET_OVERRIDE: \$\{\{ vars\.YC_STAGE_MEDIA_BUCKET \}\}$/m,
  )
  assert.match(
    mediaMigrationWorkflow,
    /target_bucket="\$\{YANDEX_MEDIA_BUCKET_OVERRIDE:-fit-stage-media-\$\{YC_FOLDER_ID:0:8\}\}"/,
  )
  assert.match(
    mediaMigrationWorkflow,
    /export YANDEX_MEDIA_BUCKET="\$target_bucket"/,
  )
  assert.match(mediaMigrationWorkflow, /npm --silent --prefix services\/api run media:migrate/)
  assert.match(
    mediaMigrationWorkflow,
    /\.mode != "apply" or \.objects == \.verified/,
  )
  assert.doesNotMatch(mediaMigrationWorkflow, /actions\/upload-artifact/)
  assert.doesNotMatch(mediaMigrationWorkflow, /\.path|object\.path|image_path/)
})

test('mirrors the Supabase bridge payload into a private stage Lockbox', () => {
  assert.match(workflow, /^  YC_STAGE_LEGACY_SUPABASE_BRIDGE_LOCKBOX_NAME: fit-stage-legacy-supabase-bridge$/m)
  assert.match(workflow, /Mirror Supabase credentials for the legacy chat media bridge[\s\S]*?supabase projects api-keys/)
  assert.match(workflow, /mirror-yandex-legacy-supabase-bridge\.mjs[\s\S]*?--payload-file "\$payload_file"/)
  assert.match(workflow, /-target=yandex_lockbox_secret_iam_member\.legacy_supabase_bridge_reader/)
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY=.*>> "\$GITHUB_ENV"/)
  assert.doesNotMatch(
    containerTerraform,
    /SUPABASE_SERVICE_ROLE_KEY\s+= "SUPABASE_SERVICE_ROLE_KEY"\s+YANDEX_CLOUD_API_KEY/,
  )
  assert.match(
    readFileSync(join(import.meta.dirname, 'mirror-yandex-legacy-supabase-bridge.mjs'), 'utf8'),
    /--deletion-protection[\s\S]*?--version-description[\s\S]*?--payload', '-'/,
  )
})

test('reuses the private dispatcher and preserves the existing DataLens access path', () => {
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
    /dynamic "secrets"[\s\S]*?APP_FEEDBACK_TELEGRAM_BOT_TOKEN[\s\S]*?APP_FEEDBACK_TELEGRAM_MESSAGE_THREAD_ID/,
  )
  assert.match(
    databaseTerraform,
    /data_lens\s+= true/,
  )
  assert.doesNotMatch(
    databaseTerraform,
    /resource "yandex_mdb_postgresql_user" "datalens"/,
  )
  assert.match(
    variablesTerraform,
    /variable "app_feedback_integrations_secret_id"[\s\S]*?== null \? true : \([\s\S]*?trimspace\(var\.app_feedback_integrations_secret_id\)/,
  )
  assert.match(
    variablesTerraform,
    /variable "app_feedback_integrations_secret_version_id"[\s\S]*?== null \? true : \([\s\S]*?trimspace\(var\.app_feedback_integrations_secret_version_id\)/,
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

test('waits for Yandex provisioning and runs configurable non-retried probes', () => {
  assert.match(workflow, /^      availability_probe_count:$/m)
  assert.match(workflow, /^        default: 50$/m)
  assert.match(workflow, /^      availability_probe_interval_seconds:$/m)
  assert.match(workflow, /sleep 300\n\s+api_url=/)
  assert.match(workflow, /verify-yandex-api-availability\.mjs/)
  assert.match(workflow, /--count "\$AVAILABILITY_PROBE_COUNT"/)
  assert.match(
    workflow,
    /--interval-ms "\$\(\( AVAILABILITY_PROBE_INTERVAL_SECONDS \* 1000 \)\)"/,
  )
  assert.match(availabilityVerifier, /for \(let probe = 1; probe <= requestedProbes/)
  assert.doesNotMatch(availabilityVerifier, /retry/iu)
})

test('keeps a healthy provisioned revision on an upstream platform failure', () => {
  assert.match(
    workflow,
    /active_min_instances=\$\(terraform show[\s\S]*?provision_policy\[0\]\.min_instances/,
  )
  assert.match(workflow, /active API revision has min_instances=/)
  assert.match(
    workflow,
    /steps\.availability\.outputs\.failure_category == 'application'/,
  )
  assert.doesNotMatch(
    workflow,
    /steps\.availability\.outputs\.failure_category == 'platform'[\s\S]*?rollback/,
  )
  assert.match(
    workflow,
    /already healthy candidate remains active because rolling it back cannot repair an upstream invocation failure/,
  )
  assert.match(
    availabilityVerifier,
    /return safeHeader\(response, 'x-fit-request-id'\) \? 'application' : 'platform'/,
  )
})

test('pins existing push identities before the authoritative registry IAM apply', () => {
  const pinIndex = workflow.lastIndexOf(
    '- name: Pin existing push runtime identities before IAM apply',
  )
  const applyIndex = workflow.indexOf(
    '- name: Apply runtime identity attachment permissions',
  )
  assert.ok(pinIndex > 0)
  assert.ok(pinIndex < applyIndex)
  assert.match(
    workflow.slice(pinIndex, applyIndex),
    /terraform output -raw push_dispatcher_service_account_id/,
  )
  assert.match(
    workflow.slice(pinIndex, applyIndex),
    /TF_VAR_push_dispatcher_registry_service_account_id=/,
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
  assert.match(smokeVerifier, /x-fit-release-id/)
  assert.match(workflow, /toupper\(\$1\) ~ \/\^HTTP\\\//)
  assert.match(workflow, /candidate_streak=0/)
  assert.match(workflow, /candidate_streak=\$\(\( candidate_streak \+ 1 \)\)/)
  assert.match(workflow, /test "\$candidate_streak" -ge 5/)
  assert.match(workflow, /stage_smoke_headers=stage-smoke-last-headers\.txt/)
  assert.match(workflow, /yandex-stage-smoke\.mjs request[\s\S]*?--dump-header "\$stage_smoke_headers" "\$@"/)
  assert.match(workflow, /trap report_stage_smoke_failure ERR/)
  assert.match(workflow, /yandex-stage-smoke\.mjs report "\$\{stage_smoke_check:-unknown\}" "\$command_exit"/)
  assert.match(smokeVerifier, /Stage smoke failed: check=/)
  assert.match(smokeVerifier, /command_exit=/)
  assert.match(smokeVerifier, /expected_release=/)
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
    'trainer-profile-photo-profile',
    'trainer-profile-photo-cleanup',
    'trainer-profile-photo-upload',
    'trainer-profile-photo-read',
    'trainer-profile-photo-delete',
  ]) {
    assert.match(workflow, new RegExp(`stage_smoke_check=${check}`))
  }
  assert.match(workflow, /The API revision was not changed/)
  assert.match(smokeVerifier, /x-fit-request-id/)
  assert.match(smokeVerifier, /HTTP=\$\{meta.http/)
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

test('refreshes only synthetic fixture sessions after bootstrap and bounds the entire product smoke', () => {
  const start = workflow.indexOf('- name: Verify API health and readiness')
  const end = workflow.indexOf('- name: Roll back the API revision when readiness or product smoke fails')
  const smoke = workflow.slice(start, end)
  const bootstrap = smoke.indexOf('test "$candidate_streak" -ge 5')
  const refresh = smoke.indexOf('/stage/fixtures/workout-read-model')
  const validation = smoke.indexOf('yandex-stage-smoke.mjs verify-fixture')
  const wrapper = smoke.indexOf('curl() {')
  const clients = smoke.indexOf('/v1/clients')
  assert.ok(bootstrap > 0 && refresh > bootstrap)
  assert.ok(validation > refresh && wrapper > validation && clients > wrapper)
  assert.match(smoke, /--connect-timeout 5 --max-time 60/)
  assert.match(smoke, /FIT_STAGE_SMOKE_DEADLINE_MS=.*Date.now\(\) \+ 600000/)
  assert.match(smoke, /chmod 600 stage-workout-fixture-response\.json/)
  assert.match(smoke, /yandex-stage-smoke\.mjs verify-deadline/)
  assert.match(workflow, /steps\.smoke\.outcome == 'failure' && steps\.previous\.outputs\.revision_id != ''/)
  assert.match(workflow, /failed health\/readiness or product smoke/)
  assert.match(workflow, /'scripts\/yandex-stage-smoke\.mjs'/)
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
  assert.match(workflow, /trainerProfileSession\.token/)
  assert.match(workflow, /X-Fit-Session: \$trainer_profile_fixture_token/)
  assert.match(workflow, /\/v1\/trainer-profile\/photos/)
  assert.match(workflow, /trainer-profile-photo-smoke\.jpg/)
  assert.match(
    workflow,
    /stage_smoke_check=trainer-profile-photo-read[\s\S]*?--retry 8 --retry-all-errors --retry-delay 2/,
  )
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
  assert.match(workflow, /live_set_version=\$\(jq -er/)
  assert.match(workflow, /expectedVersion: \$expected_version/)
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

test('keeps the legacy Vercel redirect without starting new Git deployments', () => {
  assert.equal(vercelConfig.git?.deploymentEnabled, false)
  for (const workflowName of [
    'deploy-pr-preview.yml',
    'sync-yandex-stage-preview.yml',
    'cleanup-pr-preview.yml',
  ]) {
    assert.equal(existsSync(join(import.meta.dirname, '..', '.github', 'workflows', workflowName)), false)
  }
})

test('recovers stale frontend bundles without leaving a blank screen', () => {
  assert.deepEqual(vercelConfig.routes, [
    {
      src: '/(.*)',
      has: [{ type: 'host', value: 'fit-drab.vercel.app' }],
      headers: { Location: 'https://fit-training.ru/$1' },
      status: 308,
    },
    { handle: 'filesystem' },
    { src: '/assets/.*\\.js', dest: '/asset-recovery.js' },
    { src: '/assets/.*', status: 404 },
    { src: '/(.*)', dest: '/index.html' },
  ])
  assert.match(startupHtml, /id="fit-startup-title">Открываем Fit/)
  assert.match(startupHtml, /Не удалось открыть Fit/)
  assert.match(startupHtml, /id="fit-app-entry" type="module"/)
  assert.match(assetRecoveryScript, /searchParams\.set\('fit-recover'/)
  assert.match(assetRecoveryScript, /window\.location\.replace/)
  assert.match(assetRecoveryScript, /fit:asset-load-error/)
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

test('manages the migrated tenant rollout only through an explicit private run', () => {
  assert.match(rolloutWorkflow, /^  workflow_dispatch:$/m)
  assert.doesNotMatch(rolloutWorkflow, /^  (?:push|pull_request):$/m)
  assert.match(rolloutWorkflow, /^  id-token: write$/m)
  assert.match(rolloutWorkflow, /^  group: yandex-stage$/m)
  assert.match(rolloutWorkflow, /scripts\/yandex-github-oidc\.sh/)
  assert.match(rolloutWorkflow, /GITHUB_REF.*refs\/heads\/main/)
  assert.match(
    rolloutWorkflow,
    /TENANT_FINGERPRINT: \$\{\{ vars\.FIT_YANDEX_ROLLOUT_TENANT_FINGERPRINT \}\}/g,
  )
  assert.match(rolloutWorkflow, /ENABLE_YANDEX_READ_WRITE/)
  assert.match(rolloutWorkflow, /DISABLE_YANDEX_READ_WRITE/)
  assert.match(rolloutWorkflow, /ENABLE_ALL_LINKED_YANDEX_READ_WRITE/)
  assert.match(rolloutWorkflow, /DISABLE_ALL_YANDEX_READ_WRITE/)
  assert.match(rolloutWorkflow, /Authorization: Bearer \$YC_TOKEN/)
  assert.match(rolloutWorkflow, /\/stage\/rollout-assignments\/yandex/)
  assert.match(rolloutWorkflow, /\/stage\/rollout-assignments\/yandex\/linked-ready/)
  assert.match(rolloutWorkflow, /scope: "linked-ready"/)
  assert.match(rolloutWorkflow, /domainReadyProfiles/)
  assert.match(rolloutWorkflow, /linkedProfiles/)
  assert.match(rolloutWorkflow, /rolloutEnabledProfiles/)
  assert.match(rolloutWorkflow, /allLinkedProfiles/)
  assert.match(rolloutWorkflow, /sessionReadyProfiles/)
  assert.match(rolloutWorkflow, /disabledProfiles/)
  assert.match(rolloutWorkflow, /migrationDriftProfiles/)
  assert.match(rolloutWorkflow, /domainIncompleteProfiles/)
  assert.match(
    rolloutWorkflow,
    /\.rolloutEnabledProfiles == \.linkedProfiles/,
  )
  assert.doesNotMatch(rolloutWorkflow, /terraform apply/)
  assert.doesNotMatch(rolloutWorkflow, /^    environment:/m)
  assert.match(rolloutWorkflow, /\[\[ "\$TENANT_FINGERPRINT" =~ \^\[0-9a-f\]\{16\}\$ \]\]/)
  assert.match(rolloutWorkflow, /tenantFingerprint: \$tenantFingerprint/)
  assert.doesNotMatch(
    rolloutWorkflow,
    /FIT_TENANT_TRAINER_ID|profileId/,
  )
})

test('unlinks a Yandex identity only through an explicit private run', () => {
  assert.match(identityUnlinkWorkflow, /^  workflow_dispatch:$/m)
  assert.doesNotMatch(identityUnlinkWorkflow, /^  (?:push|pull_request):$/m)
  assert.match(identityUnlinkWorkflow, /^  id-token: write$/m)
  assert.match(identityUnlinkWorkflow, /^  group: yandex-stage$/m)
  assert.match(identityUnlinkWorkflow, /scripts\/yandex-github-oidc\.sh/)
  assert.match(identityUnlinkWorkflow, /GITHUB_REF.*refs\/heads\/main/)
  assert.match(identityUnlinkWorkflow, /UNLINK_YANDEX_IDENTITY_FROM_TEST_PROFILE/)
  assert.match(identityUnlinkWorkflow, /\[\[ "\$TENANT_FINGERPRINT" =~ \^\[0-9a-f\]\{16\}\$ \]\]/)
  assert.match(identityUnlinkWorkflow, /Authorization: Bearer \$YC_TOKEN/)
  assert.match(identityUnlinkWorkflow, /\/stage\/yandex-identity\/unlink/)
  assert.match(identityUnlinkWorkflow, /tenantFingerprint: \$tenantFingerprint/)
  assert.match(identityUnlinkWorkflow, /yandex_identity_unlinked/)
  assert.match(identityUnlinkWorkflow, /identityDeleted/)
  assert.match(identityUnlinkWorkflow, /sessionsRevoked/)
  assert.doesNotMatch(identityUnlinkWorkflow, /terraform apply/)
  assert.doesNotMatch(identityUnlinkWorkflow, /^    environment:/m)
  assert.doesNotMatch(identityUnlinkWorkflow, /profileId|profile_id/)
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

const nowMs = Date.parse('2026-10-08T10:59:00Z')
const deadlineMs = nowMs + SMOKE_BUDGET_MS
const token = 'x'.repeat(43)
const clientId = '11111111-1111-4111-8111-111111111111'
function fixture(issuedAt = nowMs) {
  const session = { token, expiresAt: new Date(issuedAt + 900_000).toISOString() }
  return { status: 'fixture_ready', seededTrainerCount: 1,
    session: { ...session, clientId }, clientSession: { ...session },
    mediaSession: { ...session }, trainerProfileSession: { ...session } }
}

test('accepts fresh short-lived synthetic sessions without changing their TTL', () => {
  assert.doesNotThrow(() => verifyFixtureBudget(fixture(), deadlineMs, nowMs))
})

test('rejects pre-deployment sessions when deployment consumed their test budget', () => {
  const smokeStart = nowMs + 400_000
  assert.throws(() => verifyFixtureBudget(fixture(), smokeStart + SMOKE_BUDGET_MS, smokeStart),
    /insufficient_fixture_session_lifetime/u)
  assert.doesNotThrow(() => verifyFixtureBudget(fixture(smokeStart), smokeStart + SMOKE_BUDGET_MS, smokeStart))
})

for (const name of ['session', 'clientSession', 'mediaSession', 'trainerProfileSession']) {
  test(`checks expiry and token of ${name}, not only the trainer session`, () => {
    const expired = fixture()
    expired[name].expiresAt = new Date(nowMs - 1).toISOString()
    assert.throws(() => verifyFixtureBudget(expired, deadlineMs, nowMs), /insufficient_fixture_session_lifetime/u)
    const invalid = fixture()
    invalid[name].token = 'invalid'
    assert.throws(() => verifyFixtureBudget(invalid, deadlineMs, nowMs), /insufficient_fixture_session_lifetime/u)
    invalid[name].token = token
    invalid[name].expiresAt = 'not-a-date'
    assert.throws(() => verifyFixtureBudget(invalid, deadlineMs, nowMs), /insufficient_fixture_session_lifetime/u)
  })
}

test('fails closed on invalid fixture response or an unbounded/expired budget', () => {
  for (const invalid of [null, {}, { ...fixture(), status: 'error' },
    { ...fixture(), seededTrainerCount: 0 }, { ...fixture(), session: { token } }]) {
    assert.throws(() => verifyFixtureBudget(invalid, deadlineMs, nowMs), /invalid_smoke_fixture/u)
  }
  for (const invalid of [NaN, nowMs, nowMs - 1, deadlineMs + 1]) {
    assert.throws(() => verifyFixtureBudget(fixture(), invalid, nowMs), /invalid_smoke_budget/u)
  }
})

test('bounds each request and overrides broad retries without changing curl output', () => {
  const stdout = Buffer.from('{"status":"ok"}')
  let calls = 0
  const result = runSmokeRequest(['--retry', '8', '--retry-all-errors', '--max-time', '999',
    '--dump-header', 'headers', 'https://stage.invalid/v1/workouts'], {
    deadlineMs, nowMs, read: () => 'HTTP/1.1 200 OK\r\n',
    execute(command, args, options) {
      calls += 1
      assert.equal(command, 'curl')
      assert.deepEqual(args.slice(-6), ['--connect-timeout', '5', '--max-time', '30', '--retry', '0'])
      assert.equal(options.timeout, 30_000)
      return { status: 0, stdout }
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 0)
  assert.equal(result.stdout, stdout)
})

test('shares the same deadline across requests and clamps the final request', () => {
  for (const remaining of [1200, 250]) {
    runSmokeRequest([], { deadlineMs, nowMs: deadlineMs - remaining, read: () => '',
      execute(_command, args, options) {
        assert.equal(options.timeout, remaining)
        assert.equal(args.at(-3), String(remaining / 1000))
        return { status: 0, stdout: Buffer.alloc(0) }
      } })
  }
  const result = runSmokeRequest([], { deadlineMs, nowMs: deadlineMs,
    execute() { assert.fail('must not send a request after the suite deadline') } })
  assert.equal(result.status, 124)
  assert.equal(result.metadata.code, 'smoke_budget_exhausted')
})

test('reports a transport timeout without leaking the curl error message', () => {
  for (const response of [{ status: null, error: { code: 'ETIMEDOUT', message: 'sensitive' } },
    { status: 28, stderr: 'sensitive' }]) {
    const result = runSmokeRequest([], { deadlineMs, nowMs, read: () => '', execute: () => response })
    assert.equal(result.metadata.code, 'request_timeout')
    assert.doesNotMatch(JSON.stringify(result), /sensitive/u)
  }
})

test('distinguishes HTTP 401 from a platform failure and does not retry mutations', () => {
  let calls = 0
  const result = runSmokeRequest(['--request', 'POST', '--data', '{}',
    '--output', 'response', '--dump-header', 'headers', 'https://stage.invalid/v1/workouts'], {
    deadlineMs, nowMs,
    read: (path) => path === 'headers' ? 'HTTP/1.1 401 Unauthorized\r\n' : '{"error":"unauthorized"}',
    execute() { calls += 1; return { status: 0, stdout: Buffer.from('401') } },
  })
  assert.equal(calls, 1)
  assert.equal(result.stdout.toString(), '401')
  assert.equal(result.metadata.http, '401')
  assert.equal(result.metadata.category, 'authentication')
  assert.equal(result.metadata.code, 'unauthorized')
  assert.equal(result.metadata.method, 'POST')
})

test('preserves expected 409 responses rather than converting them to transport errors', () => {
  const result = runSmokeRequest(['--request', 'PUT', '--dump-header', 'headers'], {
    deadlineMs, nowMs, read: () => 'HTTP/1.1 409 Conflict\r\n',
    execute: () => ({ status: 0, stdout: Buffer.from('409') }),
  })
  assert.equal(result.status, 0)
  assert.equal(result.metadata.http, '409')
})

test('does not use a stale response body when curl failed', () => {
  const result = runSmokeRequest(['--output', 'body', '--dump-header', 'headers'], {
    deadlineMs, nowMs,
    read: (path) => path === 'headers' ? 'HTTP/1.1 503 Failed\r\n' : '{"error":"unauthorized"}',
    execute: () => ({ status: 22 }),
  })
  assert.equal(result.status, 22)
  assert.equal(result.metadata.http, '503')
  assert.equal(result.metadata.code, 'unknown')
})

test('only records the final HTTP block and validated safe diagnostic fields', () => {
  const release = 'a'.repeat(40)
  const metadata = safeRequestMetadata(['--request', 'DELETE',
    `https://stage.invalid/v1/workouts/${clientId}?token=private`],
  `HTTP/1.1 502 Bad Gateway\r\nx-fit-error-code: OLD_CODE\r\n\r\nHTTP/1.1 401 Unauthorized\r\nx-fit-request-id: ${clientId}\r\nx-fit-release-id: ${release}\r\n`,
  '{"error":"unauthorized","token":"private"}', 0)
  assert.equal(metadata.http, '401')
  assert.equal(metadata.code, 'unauthorized')
  assert.equal(metadata.release, release)
  assert.equal(metadata.requestId, clientId)
  assert.equal(metadata.route, '/v1/workouts/…')
  assert.doesNotMatch(JSON.stringify(metadata), /private|OLD_CODE|stage.invalid/u)
})

test('does not persist arbitrary error text, unsafe headers, or signed object URLs', () => {
  const metadata = safeRequestMetadata(['https://objects.invalid/private/path?signature=private'],
    'HTTP/1.1 503 Failed\r\nx-fit-error-category: private\r\nx-fit-error-code: private\r\nx-fit-request-id: private\r\nx-fit-release-id: private\r\n',
    '{"error":"private","details":"private"}', 0)
  assert.equal(metadata.route, 'external-object')
  assert.equal(metadata.code, 'unknown')
  assert.doesNotMatch(JSON.stringify(metadata), /private|signature|objects.invalid/u)
})

test('real curl/CLI preserves a 401 body and status, emits safe diagnostics and sends POST once', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fit-smoke-contract-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let calls = 0
  const server = createServer((request, response) => {
    calls += 1
    assert.equal(request.method, 'POST')
    response.writeHead(401, { 'content-type': 'application/json', 'x-fit-release-id': 'a'.repeat(40) })
    response.end('{"error":"unauthorized","details":"not-for-logs"}')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const metadataFile = join(directory, 'metadata.json')
  const env = { ...process.env, FIT_STAGE_SMOKE_DEADLINE_MS: String(Date.now() + SMOKE_BUDGET_MS),
    FIT_STAGE_SMOKE_METADATA: metadataFile, API_IMAGE_TAG: 'a'.repeat(40) }
  const helper = join(import.meta.dirname, 'yandex-stage-smoke.mjs')
  const run = promisify(execFile)
  const { stdout } = await run(process.execPath, [helper, 'request', '--silent', '--show-error',
    '--request', 'POST', '--data', '{}', '--retry', '8', '--retry-all-errors', '--retry-delay', '2',
    '--dump-header', join(directory, 'headers'), '--output', join(directory, 'body'),
    '--write-out', '%{http_code}', `http://127.0.0.1:${server.address().port}/v1/workouts`],
  { env, timeout: 5000 })
  assert.equal(stdout, '401')
  assert.equal(calls, 1)
  assert.equal(JSON.parse(await readFile(join(directory, 'body'), 'utf8')).error, 'unauthorized')
  const { stderr } = await run(process.execPath, [helper, 'report', 'planned-workout-create', '1'], { env, timeout: 5000 })
  assert.match(stderr, /check=planned-workout-create; method=POST; route=\/v1\/workouts; HTTP=401/u)
  assert.match(stderr, /category=authentication; code=unauthorized/u)
  assert.doesNotMatch(stderr, /not-for-logs|127\.0\.0\.1/u)
  assert.doesNotMatch(await readFile(metadataFile, 'utf8'), /not-for-logs|127\.0\.0\.1/u)
  await assert.rejects(run(process.execPath, [helper, 'request', '--fail', '--silent',
    '--request', 'POST', '--data', '{}', '--retry', '8', '--retry-all-errors', '--retry-delay', '2',
    '--dump-header', join(directory, 'headers'),
    `http://127.0.0.1:${server.address().port}/v1/workouts`], { env, timeout: 5000 }),
  (error) => error.code === 22 && error.stderr.includes('exit=22'))
  assert.equal(calls, 2, 'the second POST must not be retried either, even with --fail')
  const failedMetadata = JSON.parse(await readFile(metadataFile, 'utf8'))
  assert.equal(failedMetadata.http, '401')
  assert.equal(failedMetadata.code, 'unauthorized')
})
