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
  assert.match(workflow, /lane: \[1, 2, 3, 4\]/)
  assert.match(workflow, /Run iPhone behavior scenarios in isolated parallel lanes/)
  assert.match(workflow, /for shard in \$\(seq "\$\{\{ matrix\.lane \}\}" 4 8\)/)
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
  assert.match(workflow, /e2e:\n    needs: \[e2e-scope, e2e-visual, e2e-chromium, e2e-webkit\]/)
  assert.match(workflow, /VISUAL_RESULT: \$\{\{ needs\.e2e-visual\.result \}\}/)
  assert.match(workflow, /CHROMIUM_RESULT: \$\{\{ needs\.e2e-chromium\.result \}\}/)
  assert.match(workflow, /E2E skipped: changes do not affect the browser runtime/)
})

test('runs visual viewport shards in parallel with an isolated database each', () => {
  assert.match(workflow, /e2e-visual:[\s\S]*max-parallel: 6/)
  assert.match(workflow, /project: \[visual-client-390, visual-client-430, visual-trainer-1440\]/)
  assert.match(workflow, /shard: \[1\/2, 2\/2\]/)
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
  assert.match(workflow, /app-tests:[\s\S]*- run: npm run test:coverage/)
  assert.match(workflow, /app:\n    needs: \[app-quality, app-tests\]/)
  assert.match(workflow, /QUALITY_RESULT: \$\{\{ needs\.app-quality\.result \}\}/)
  assert.match(workflow, /TESTS_RESULT: \$\{\{ needs\.app-tests\.result \}\}/)
  assert.match(workflow, /App checks failed: quality=\$QUALITY_RESULT tests=\$TESTS_RESULT/)
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
