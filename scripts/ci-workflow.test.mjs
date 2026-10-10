import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'),
  'utf8',
)

const supportedSupabaseCliVersion = '2.116.0'

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
  assert.ok(job.indexOf('prepare-fit-lime-ci-fonts.mjs') < job.indexOf('playwright test'))
  assert.match(job, /project: mobile-chromium\n\s+browser: chromium/)
  assert.match(job, /project: lime-acceptance-webkit\n\s+browser: webkit/)
  assert.match(job, /playwright install --with-deps \$\{\{ matrix\.browser \}\}/)
  assert.match(job, /playwright test e2e\/trainer-schedule-v2\.visual\.spec\.ts/)
  assert.match(job, /--project=\$\{\{ matrix\.project \}\} --workers=2/)
  assert.doesNotMatch(job, /secrets\.|supabase start|environment:/)
  assert.match(workflow, /FIT_LIME_RESULT: \$\{\{ needs\.e2e-fit-lime\.result \}\}/)
  assert.match(workflow, /"\$FIT_LIME_RESULT" != "success"/)
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
