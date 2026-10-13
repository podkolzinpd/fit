import { readFileSync, readlinkSync, realpathSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'),
  'utf8',
)

const supportedSupabaseCliVersion = '2.116.0'
const migrationOnlyWorkflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'deploy-yandex-migration-container-only.yml'),
  'utf8',
)

test('migration-only recovery cannot refresh triggers or deploy public traffic', () => {
  assert.match(migrationOnlyWorkflow, /workflow_dispatch:/)
  assert.match(migrationOnlyWorkflow, /DEPLOY_YANDEX_MIGRATION_CONTAINER_ONLY/)
  assert.match(migrationOnlyWorkflow, /-target=yandex_serverless_container\.migration/)
  assert.match(migrationOnlyWorkflow, /-target=yandex_serverless_container_iam_binding\.migration_invocation/)
  assert.match(migrationOnlyWorkflow, /check-yandex-migration-container-plan\.mjs/)
  assert.match(migrationOnlyWorkflow, /deploy-yandex-serverless-revision\.mjs deploy/)
  assert.match(migrationOnlyWorkflow, /revision list[\s\S]*?status == "ACTIVE"/)
  assert.match(migrationOnlyWorkflow, /steps\.candidate\.outcome == 'failure' \|\| steps\.smoke\.outcome == 'failure'/)
  assert.match(migrationOnlyWorkflow, /deploy-yandex-serverless-revision\.mjs rollback/)
  assert.match(migrationOnlyWorkflow, /database-export/)
  assert.doesNotMatch(migrationOnlyWorkflow, /terraform apply|refresh-only|yandex_function_trigger|system:allUsers/)
})

test('runs isolated WebKit shards in four parallel lanes and retries only a failed shard', () => {
  assert.match(workflow, /e2e-webkit:/)
  assert.match(workflow, /max-parallel: 4/)
  assert.match(workflow, /lane: 1\n\s+shards: '1 7'/)
  assert.match(workflow, /lane: 2\n\s+shards: '2 5'/)
  assert.match(workflow, /lane: 3\n\s+shards: '3 6'/)
  assert.match(workflow, /lane: 4\n\s+shards: '4 8'/)
  assert.match(workflow, /Run iPhone behavior scenarios in isolated parallel lanes/)
  assert.match(workflow, /for shard in \$\{\{ matrix\.shards \}\}/)
  assert.match(workflow, /--shard="\$\{shard\}\/8"/)
  assert.match(workflow, /if ! run_webkit_shard "\$shard"/)
  assert.match(workflow, /retrying once in a fresh container/)
  assert.doesNotMatch(
    workflow,
    /npx playwright test --project=iphone-13-webkit --workers=1/,
  )
})

test('keeps one required E2E result while skipping heavy jobs only for a safe scope', () => {
  assert.match(workflow, /e2e-scope:/)
  assert.match(workflow, /node scripts\/e2e-scope\.mjs "\$BASE_SHA" "\$HEAD_SHA"/)
  assert.match(workflow, /e2e-visual:/)
  assert.match(workflow, /e2e-chromium:/)
  assert.match(workflow, /if: needs\.e2e-scope\.outputs\.required == 'true'/)
  assert.match(workflow, /e2e:\n    needs: \[e2e-scope, e2e-yandex-auth, e2e-visual, e2e-chromium, e2e-webkit, e2e-fit-lime\]/)
  assert.match(workflow, /YANDEX_AUTH_RESULT: \$\{\{ needs\.e2e-yandex-auth\.result \}\}/)
  assert.match(workflow, /"\$YANDEX_AUTH_RESULT" != "success"/)
  assert.match(workflow, /VISUAL_RESULT: \$\{\{ needs\.e2e-visual\.result \}\}/)
  assert.match(workflow, /CHROMIUM_RESULT: \$\{\{ needs\.e2e-chromium\.result \}\}/)
  assert.match(workflow, /E2E skipped: changes do not affect the browser runtime/)
})

test('requires Fit Lime route checks in both engines without production secrets', () => {
  const job = workflow.slice(workflow.indexOf('  e2e-fit-lime:\n'), workflow.indexOf('  e2e:\n'))
  assert.match(job, /FIT_SCHEDULE_V2_VISUAL: '1'/)
  assert.match(job, /FIT_LIME_FONTS_REQUIRED: 'true'/)
  assert.match(job, /node scripts\/prepare-fit-lime-ci-fonts\.mjs/)
  assert.ok(job.indexOf('prepare-fit-lime-ci-fonts.mjs') < job.indexOf('run-fit-lime-ci.mjs'))
  assert.match(job, /project: mobile-chromium\n\s+browser: chromium/)
  assert.match(job, /project: lime-acceptance-webkit\n\s+browser: webkit/)
  assert.match(job, /playwright install --with-deps \$\{\{ matrix\.browser \}\}/)
  assert.match(job, /node scripts\/run-fit-lime-ci\.mjs "\$LIME_PROJECT" "\$LIME_MODE" "\$LIME_TAGS"/)
  assert.match(job, /LIME_PROJECT: \$\{\{ matrix\.project \}\}/)
  assert.match(job, /LIME_MODE: \$\{\{ needs\.e2e-scope\.outputs\.lime_mode \}\}/)
  assert.match(job, /LIME_TAGS: \$\{\{ needs\.e2e-scope\.outputs\.lime_tags \}\}/)
  assert.doesNotMatch(job, /secrets\.|supabase start|environment:/)
  assert.match(workflow, /FIT_LIME_RESULT: \$\{\{ needs\.e2e-fit-lime\.result \}\}/)
  assert.match(workflow, /"\$FIT_LIME_RESULT" != "success"/)
})

test('Fit Lime scope is computed from the real PR diff and trusted event without a bypass input', () => {
  assert.match(workflow, /lime_mode: \$\{\{ steps\.lime-scope\.outputs\.mode \}\}/)
  assert.match(workflow, /lime_tags: \$\{\{ steps\.lime-scope\.outputs\.tags \}\}/)
  assert.match(workflow, /node scripts\/fit-lime-ci-scope\.mjs "\$BASE_SHA" "\$HEAD_SHA"/)
  const start = workflow.indexOf('      - name: Select temporary PR Fit Lime acceptance scope')
  const selection = workflow.slice(start, workflow.indexOf('\n  #', start))
  assert.match(selection, /EVENT_NAME: \$\{\{ github\.event_name \}\}/)
  assert.match(selection, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}/)
  assert.match(selection, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/)
  assert.doesNotMatch(selection, /inputs\.|secrets\./)
})

test('runs required Yandex-only browser auth without starting local Supabase', () => {
  const start = workflow.indexOf('  e2e-yandex-auth:\n')
  const end = workflow.indexOf('  e2e-visual:\n', start)
  assert.ok(start >= 0 && end > start)
  const job = workflow.slice(start, end)

  assert.match(job, /needs: e2e-scope\n    if: needs\.e2e-scope\.outputs\.required == 'true'/)
  assert.match(job, /FIT_YANDEX_E2E_REQUIRED: 'true'/)
  assert.match(job, /VITE_YANDEX_OAUTH_CLIENT_ID: fixture-client-id/)
  assert.match(job, /VITE_YANDEX_API_BASE_URL: https:\/\/stage\.example\.test/)
  for (const flag of [
    'VITE_YANDEX_ONLY_AUTH_ENABLED',
    'VITE_YANDEX_NATIVE_REGISTRATION_ENABLED',
    'VITE_YANDEX_APP_SESSION_ENABLED',
    'VITE_YANDEX_MAIN_ROUTING_ENABLED',
  ]) {
    assert.match(job, new RegExp(`${flag}: 'true'`))
    assert.match(job, new RegExp(`--env ${flag}`))
  }
  assert.match(job, /playwright test e2e\/yandex-only-auth\.webkit\.spec\.ts e2e\/nutrition-diary\.webkit\.spec\.ts --project=iphone-13-webkit --workers=1 --fail-on-flaky-tests/)
  assert.doesNotMatch(job, /supabase\/setup-cli|supabase start|supabase db reset|wait-for-local-auth/)
})

test('runs client visual shards and one trainer visual job with isolated databases', () => {
  assert.match(workflow, /e2e-visual:[\s\S]*max-parallel: 5/)
  assert.match(workflow, /project: visual-client-390\n\s+shard: 1\/2/)
  assert.match(workflow, /project: visual-client-390\n\s+shard: 2\/2/)
  assert.match(workflow, /project: visual-client-430\n\s+shard: 1\/2/)
  assert.match(workflow, /project: visual-client-430\n\s+shard: 2\/2/)
  assert.match(workflow, /project: visual-trainer-1440\n\s+shard: 1\/1/)
  assert.match(workflow, /--env PLAYWRIGHT_PROJECT="\$\{\{ matrix\.project \}\}"/)
  assert.match(workflow, /--env PLAYWRIGHT_SHARD/)
  assert.match(workflow, /--project="\$PLAYWRIGHT_PROJECT" --workers=1 --shard="\$PLAYWRIGHT_SHARD"/)
  assert.doesNotMatch(workflow, /for project in visual-client-390/)
})

test('runs Chromium behavior scenarios in two isolated shards', () => {
  assert.match(workflow, /e2e-chromium:[\s\S]*max-parallel: 2/)
  assert.match(workflow, /e2e-chromium:[\s\S]*shard: \[1\/2, 2\/2\]/)
  assert.match(workflow, /--project=mobile-chromium --shard="\$PLAYWRIGHT_SHARD"/)
  assert.match(workflow, /playwright-diagnostics-chromium-\$\{\{ strategy\.job-index \}\}/)
})

test('keeps the required app check stable while quality and coverage run in parallel', () => {
  assert.match(workflow, /app-quality:[\s\S]*- run: npm run lint[\s\S]*- run: npm run build/)
  assert.match(workflow, /app-quality:[\s\S]*- run: npm run db:types:check[\s\S]*- run: npm run build/)
  assert.match(workflow, /app-tests:[\s\S]*- run: npm run test:coverage/)
  assert.match(workflow, /app:\n    needs: \[app-quality, app-tests, frontend-infrastructure\]/)
  assert.match(workflow, /INFRA_RESULT: \$\{\{ needs\.frontend-infrastructure\.result \}\}/)
  assert.match(workflow, /"\$INFRA_RESULT" != "success"/)
  assert.match(workflow, /QUALITY_RESULT: \$\{\{ needs\.app-quality\.result \}\}/)
  assert.match(workflow, /TESTS_RESULT: \$\{\{ needs\.app-tests\.result \}\}/)
  assert.match(workflow, /App checks failed: quality=\$QUALITY_RESULT tests=\$TESTS_RESULT/)
})

test('runs heavy legacy database checks only for relevant changes or a manual CI run', () => {
  assert.match(workflow, /database:\n    needs: e2e-scope\n    if: needs\.e2e-scope\.outputs\.database_required == 'true'/)
  assert.match(workflow, /database_required: \$\{\{ steps\.database-scope\.outputs\.required \}\}/)
  assert.match(workflow, /id: database-scope\n\s+run: node scripts\/supabase-database-scope\.mjs "\$EVENT_NAME" "\$BASE_SHA" "\$HEAD_SHA"/)
  assert.match(workflow, /EVENT_NAME: \$\{\{ github\.event_name \}\}/)
  assert.match(workflow, /- run: supabase test db --local/)
})

test('waits for local auth readiness before auth-dependent E2E jobs', () => {
  assert.match(
    workflow,
    /e2e-visual:[\s\S]*?- run: supabase db reset --local\n\s+- run: node scripts\/wait-for-local-auth\.mjs/,
  )
  assert.match(
    workflow,
    /e2e-chromium:[\s\S]*?- run: supabase db reset --local\n\s+- run: node scripts\/wait-for-local-auth\.mjs/,
  )
  assert.match(
    workflow,
    /e2e-webkit:[\s\S]*- run: supabase db reset --local\n\s+- run: node scripts\/wait-for-local-auth\.mjs/,
  )
})

test('does not start Supabase services that CI scenarios do not use', () => {
  assert.match(
    workflow,
    /SUPABASE_DATABASE_EXCLUDE: edge-runtime,gotrue,imgproxy,kong,logflare,mailpit,postgres-meta,postgrest,realtime,storage-api,studio,supavisor,vector/,
  )
  assert.match(
    workflow,
    /SUPABASE_E2E_EXCLUDE: edge-runtime,imgproxy,logflare,mailpit,postgres-meta,storage-api,studio,supavisor,vector/,
  )

  const databaseJob = workflow.slice(workflow.indexOf('  database:\n'), workflow.indexOf('  yandex-database:\n'))
  assert.match(databaseJob, /supabase start --exclude "\$SUPABASE_DATABASE_EXCLUDE"/)

  for (const job of ['e2e-visual', 'e2e-chromium', 'e2e-webkit']) {
    const start = workflow.indexOf(`  ${job}:\n`)
    assert.notEqual(start, -1, `${job} job is missing`)
    const body = workflow.slice(start).split(/\n  [a-z][a-z0-9-]*:\n/, 1)[0]
    assert.match(body, /supabase start --exclude "\$SUPABASE_E2E_EXCLUDE"/)
  }
})

test('clears the setup-cli override to retain official registry fallback in every database-backed CI job', () => {
  for (const job of ['database', 'e2e-visual', 'e2e-chromium', 'e2e-webkit']) {
    const start = workflow.indexOf(`  ${job}:\n`)
    assert.notEqual(start, -1, `${job} job is missing`)
    const body = workflow.slice(start).split(/\n  [a-z][a-z0-9-]*:\n/, 1)[0]

    assert.match(
      body,
      /name: Allow official Supabase registry fallbacks\n\s+run: echo 'SUPABASE_INTERNAL_IMAGE_REGISTRY=' >> "\$GITHUB_ENV"/,
    )
    assert.ok(
      body.indexOf('Allow official Supabase registry fallbacks') < body.indexOf('supabase start --exclude'),
      `${job} must retain fallback before pulling Supabase images`,
    )
    assert.doesNotMatch(body, /SUPABASE_INTERNAL_IMAGE_REGISTRY=docker\.io/)
  }
})

test('uses the identical pinned PostgreSQL17 image without changing health or migration checks', () => {
  const body = workflow.slice(workflow.indexOf('  yandex-database:\n'), workflow.indexOf('  e2e-scope:\n'))
  assert.match(body, /image: public\.ecr\.aws\/docker\/library\/postgres:17@sha256:3cec7eb015ba8adb28139fa5c83b8489cdf0e666e53dfdf20f598ae0cc8739e3/)
  assert.match(body, /--health-cmd "pg_isready -U postgres -d fit_actor_test"/)
  assert.match(body, /npm --prefix services\/api run test:db/)
  assert.match(body, /npm --prefix services\/api run db:migrate/)
  assert.doesNotMatch(body, /continue-on-error|always\(\)|allowFailure/)
})

test('runs the complete Yandex API check independently from browser E2E', () => {
  assert.match(workflow, /api:[\s\S]*cache-dependency-path: services\/api\/package-lock\.json/)
  assert.match(workflow, /api:[\s\S]*- run: npm ci --prefix services\/api/)
  assert.match(workflow, /api:[\s\S]*- run: npm --prefix services\/api run check/)
})

test('cancels a superseded CI run for the same pull request', () => {
  assert.match(workflow, /concurrency:\n  group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/)
  assert.match(workflow, /cancel-in-progress: true/)
})

test('uses a Supabase CLI version that reloads Kong after db reset', () => {
  const configuredVersions = [...workflow.matchAll(/uses: supabase\/setup-cli@v1\n\s+with:[\s\S]*?\n\s+version: ([^\s]+)/g)]
    .map((match) => match[1])

  assert.ok(configuredVersions.length > 0)
  assert.deepEqual(
    [...new Set(configuredVersions)],
    [supportedSupabaseCliVersion],
  )
})

const cloudruBootstrap = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'deploy-cloudru-stage.yml'), 'utf8')
const cloudruApi = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'deploy-cloudru-api-stage.yml'), 'utf8')
const cloudruDatabaseMigration = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'migrate-yandex-database-to-cloudru.yml'), 'utf8')

function inlineShell(workflowSource) {
  return [...workflowSource.matchAll(/run: \|\n((?:          [^\n]*(?:\n|$))+)/g)]
    .map((match) => match[1].replace(/^          /gm, '').replace(/\$\{\{[^}]+\}\}/g, 'fixture'))
}

test('Cloud.ru bootstrap is manual-only and shares the VM lock with API builds', () => {
  assert.match(cloudruBootstrap, /^name: Bootstrap Cloud\.ru stage runner\n/)
  assert.match(cloudruBootstrap, /on:\n  workflow_dispatch:\n/)
  assert.doesNotMatch(cloudruBootstrap, /^  (?:push|pull_request|schedule):/m)
  assert.match(cloudruBootstrap, /group: cloudru-stage-vm\n  cancel-in-progress: false/)
  assert.match(cloudruBootstrap, /secrets\.CLOUDRU_RUNNER_REGISTRATION_TOKEN/)
  assert.doesNotMatch(cloudruBootstrap, /podman (?:run|start|create|exec)\b/)
})

test('Cloud.ru API builds use only the self-hosted runner with default-off autodeploy', () => {
  assert.match(cloudruApi, /push:\n    branches: \[main\]\n    paths:\n      - 'services\/api\/\*\*'\n  workflow_dispatch:/)
  assert.match(cloudruApi, /permissions:\n  contents: read\n/)
  assert.match(cloudruApi, /if: github\.event_name == 'workflow_dispatch' \|\| vars\.CLOUDRU_STAGE_AUTODEPLOY_ENABLED == 'true'/)
  assert.match(cloudruApi, /runs-on: \[self-hosted, cloudru-stage\]/)
  assert.match(cloudruApi, /concurrency:\n      group: cloudru-stage-vm\n      cancel-in-progress: false/)
  assert.doesNotMatch(cloudruApi, /secrets\.|id-token:|ssh|scp|registration|private.key|podman (?:run|start|create|exec)\b|db:migrate|psql/i)
})

test('Cloud.ru database migration is manual, confirmed and loopback-only', () => {
  assert.match(cloudruDatabaseMigration, /^name: Migrate Yandex database to Cloud\.ru\n/)
  assert.match(cloudruDatabaseMigration, /on:\n  workflow_dispatch:/)
  assert.doesNotMatch(cloudruDatabaseMigration, /^  (?:push|pull_request|schedule):/m)
  assert.match(cloudruDatabaseMigration, /runs-on: \[self-hosted, cloudru-stage\]/)
  assert.match(cloudruDatabaseMigration, /group: cloudru-stage-vm\n  cancel-in-progress: false/)
  assert.match(cloudruDatabaseMigration, /MIGRATE_YANDEX_STAGE_DATABASE_TO_CLOUDRU/)
  assert.match(cloudruDatabaseMigration, /initial-backup:4d767352-63f1-41ca-b1a2-b07e81afb028:ready/)
  assert.match(cloudruDatabaseMigration, /PGSSLMODE=verify-full/g)
  assert.match(cloudruDatabaseMigration, /PGSSLMODE=verify-full PGSSLROOTCERT="\$ca" PGCONNECT_TIMEOUT=10/)
  assert.doesNotMatch(cloudruDatabaseMigration, /openssl s_client -starttls postgres/)
  assert.match(cloudruDatabaseMigration, /db:migrate:dry-run/)
  assert.match(cloudruDatabaseMigration, /cloud-database-restore-cli\.js/)
  assert.match(cloudruDatabaseMigration, /--publish 127\.0\.0\.1:18080:8080/)
  assert.doesNotMatch(cloudruDatabaseMigration, /sslmode=(?:disable|require)|--publish 0\.0\.0\.0/)
})

test('Cloud.ru validates main, hostname, runner service and Podman before touching a release', () => {
  const preflight = inlineShell(cloudruApi)[0]
  for (const required of ['test "$GITHUB_REF" = "refs/heads/main"', 'test "$(hostname)" = "fit-stage-app"',
    'actions.runner.podkolzinpd-fit.fit-cloudru-stage.service', 'sudo podman info >/dev/null']) {
    assert.ok(preflight.includes(required), required)
  }
  assert.match(cloudruApi, /ref: \$\{\{ github\.sha \}\}\n          persist-credentials: false/)
  assert.ok(cloudruApi.indexOf('Verify trusted stage runner') < cloudruApi.indexOf('actions/checkout@'))
  assert.doesNotMatch(preflight, /install|tar|build|tee|\bln\b|\bmv\b/)
})

test('Cloud.ru markers advance only after the exact revision image is confirmed', () => {
  const scripts = inlineShell(cloudruApi)
  assert.equal(scripts.length, 3)
  assert.match(scripts[1], /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/)
  assert.match(scripts[1], /git archive --format=tar "\$GITHUB_SHA" \| sudo tar/)
  assert.match(scripts[1], /podman build --pull=always/)
  assert.match(scripts[1], /podman image exists "localhost\/fit-api:\$GITHUB_SHA"/)
  assert.doesNotMatch(scripts[1], /tee|\bln\b|\bmv\b/)
  assert.ok(scripts[2].indexOf('podman image exists') < scripts[2].indexOf('sudo ln'))
  assert.match(scripts[2], /printf '%s\\n' "\$GITHUB_SHA" \| sudo tee "\$next_sha"/)
  assert.match(scripts[2], /sudo mv -Tf "\$next_link" \/opt\/fit\/current/)
  assert.match(scripts[2], /sudo mv -Tf "\$next_sha" \/opt\/fit\/DEPLOYED_SHA/)
  assert.match(scripts[2], /test "\$\(readlink -f \/opt\/fit\/current\)" = "\$release_dir"/)
  assert.match(scripts[2], /test "\$\(cat \/opt\/fit\/DEPLOYED_SHA\)" = "\$GITHUB_SHA"/)
})

test('Cloud.ru workflows contain syntactically valid Bash', () => {
  for (const source of [cloudruBootstrap, cloudruApi, cloudruDatabaseMigration]) {
    for (const script of inlineShell(source)) {
      const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
    }
  }
})

function withCloudruBuildFixture(overrides, verify) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'fit-cloudru-build-')))
  const root = join(directory, 'fit')
  const source = join(directory, 'source')
  const sha = 'a'.repeat(40)
  const previous = join(root, 'releases', 'previous')
  try {
    mkdirSync(previous, { recursive: true })
    mkdirSync(join(source, 'services', 'api'), { recursive: true })
    writeFileSync(join(source, 'services', 'api', 'Dockerfile'), 'FROM scratch\n')
    symlinkSync(previous, join(root, 'current'))
    writeFileSync(join(root, 'DEPLOYED_SHA'), 'previous\n')
    const mocks = `
      hostname() { printf '%s\\n' "$FIXTURE_HOST"; }
      readlink() {
        test "$1" = -f || return 85
        "$FIXTURE_NODE" --input-type=module -e 'import { realpathSync } from "node:fs"; console.log(realpathSync(process.argv[1]));' "$2"
      }
      sudo() {
        if [ "$1" = systemctl ]; then
          test "$*" = "systemctl is-active --quiet actions.runner.podkolzinpd-fit.fit-cloudru-stage.service" || return 80
          return "$FIXTURE_SERVICE_EXIT"
        fi
        if [ "$1" = podman ]; then
          shift
          case "$1" in
            info) return "$FIXTURE_INFO_EXIT" ;;
            build) printf '%s\\n' build >> "$FIXTURE_CALLS"; return "$FIXTURE_BUILD_EXIT" ;;
            image) test "$*" = "image exists localhost/fit-api:$GITHUB_SHA" || return 81; return "$FIXTURE_IMAGE_EXIT" ;;
            *) return 82 ;;
          esac
        elif [ "$1" = mv ]; then
          test "$2" = -Tf || return 86
          "$FIXTURE_NODE" --input-type=module -e 'import { renameSync } from "node:fs"; renameSync(process.argv[1], process.argv[2]);' "$3" "$4"
        else
          command "$@"
        fi
      }
      git() {
        case "$1" in
          rev-parse) printf '%s\\n' "$FIXTURE_CHECKOUT_SHA" ;;
          archive) test "$*" = "archive --format=tar $GITHUB_SHA" || return 83; command tar -cf - -C "$FIXTURE_SOURCE" . ;;
          *) return 84 ;;
        esac
      }
    `
    const script = inlineShell(cloudruApi).join('\n').replaceAll('/opt/fit', root)
    const result = spawnSync('bash', ['-c', mocks + '\n' + script], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_REPOSITORY: 'podkolzinpd/fit', GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: sha, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', FIXTURE_HOST: 'fit-stage-app',
        FIXTURE_SERVICE_EXIT: '0', FIXTURE_INFO_EXIT: '0', FIXTURE_BUILD_EXIT: '0', FIXTURE_IMAGE_EXIT: '0',
        FIXTURE_SOURCE: source, FIXTURE_CALLS: join(directory, 'calls'), FIXTURE_CHECKOUT_SHA: sha,
        FIXTURE_NODE: process.execPath, ...overrides },
    })
    verify({ result, root, previous, sha, calls: join(directory, 'calls') })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('Cloud.ru successful local build records its exact SHA and isolated versioned source', () => {
  withCloudruBuildFixture({}, ({ result, root, sha, calls }) => {
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(calls, 'utf8'), 'build\n')
    assert.equal(readFileSync(join(root, 'DEPLOYED_SHA'), 'utf8'), sha + '\n')
    assert.equal(readlinkSync(join(root, 'current')), join(root, 'releases', sha, '123-1'))
    assert.equal(readFileSync(join(root, 'current', 'services', 'api', 'Dockerfile'), 'utf8'), 'FROM scratch\n')
  })
})

test('Cloud.ru untrusted or unhealthy runner cannot advance the prepared revision', () => {
  for (const overrides of [{ GITHUB_REF: 'refs/heads/other' }, { FIXTURE_HOST: 'other-host' },
    { FIXTURE_SERVICE_EXIT: '3' }, { FIXTURE_INFO_EXIT: '125' }, { FIXTURE_CHECKOUT_SHA: 'b'.repeat(40) }]) {
    withCloudruBuildFixture(overrides, ({ result, root, previous }) => {
      assert.notEqual(result.status, 0)
      assert.equal(readlinkSync(join(root, 'current')), previous)
      assert.equal(readFileSync(join(root, 'DEPLOYED_SHA'), 'utf8'), 'previous\n')
    })
  }
})

test('Cloud.ru failed Podman build preserves the previous current link and SHA', () => {
  withCloudruBuildFixture({ FIXTURE_BUILD_EXIT: '125' }, ({ result, root, previous }) => {
    assert.equal(result.status, 125)
    assert.equal(readlinkSync(join(root, 'current')), previous)
    assert.equal(readFileSync(join(root, 'DEPLOYED_SHA'), 'utf8'), 'previous\n')
  })
})

test('Cloud.ru missing built image cannot advance current or SHA', () => {
  withCloudruBuildFixture({ FIXTURE_IMAGE_EXIT: '1' }, ({ result, root, previous }) => {
    assert.equal(result.status, 1)
    assert.equal(readlinkSync(join(root, 'current')), previous)
    assert.equal(readFileSync(join(root, 'DEPLOYED_SHA'), 'utf8'), 'previous\n')
  })
})
