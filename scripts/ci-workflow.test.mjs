import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'),
  'utf8',
)

const supportedSupabaseCliVersion = '2.116.0'

test('runs isolated WebKit shards in two parallel lanes and retries only a failed shard', () => {
  assert.match(workflow, /e2e-webkit:/)
  assert.match(workflow, /max-parallel: 2/)
  assert.match(workflow, /lane: \[1, 2\]/)
  assert.match(workflow, /Run iPhone behavior scenarios in isolated parallel lanes/)
  assert.match(workflow, /for shard in \$\(seq "\$\{\{ matrix\.lane \}\}" 2 8\)/)
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

test('runs visual viewport profiles in parallel with an isolated database each', () => {
  assert.match(workflow, /e2e-visual:[\s\S]*max-parallel: 3/)
  assert.match(workflow, /project: \[visual-client-390, visual-client-430, visual-trainer-1440\]/)
  assert.match(workflow, /--env PLAYWRIGHT_PROJECT="\$\{\{ matrix\.project \}\}"/)
  assert.match(workflow, /--project="\$PLAYWRIGHT_PROJECT" --workers=1/)
  assert.doesNotMatch(workflow, /for project in visual-client-390/)
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
