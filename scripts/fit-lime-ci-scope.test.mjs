import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fitLimeInventoryDigest, reviewedInventoryFiles, reviewedInventoryDigest, scopedPrExpiresAt, selectFitLimeScope } from './fit-lime-ci-scope.mjs'
import { fitLimeArgs, validateFitLimeInventory } from './run-fit-lime-ci.mjs'
import './fit-lime-split.test.mjs'

const activePr = { eventName: 'pull_request', now: new Date('2026-10-12T12:00:00Z'), inventoryDigest: reviewedInventoryDigest }
const finance = 'src/features/finance/ClientFinancePage.tsx'

test('scopes known feature pages and includes critical cases for both engines', () => {
  const result = selectFitLimeScope([finance, 'docs/CURRENT_STATE.md'], activePr)
  assert.equal(result.mode, 'scoped')
  assert.deepEqual(result.tags, ['critical', 'finance'])
  for (const project of ['mobile-chromium', 'lime-acceptance-webkit']) {
    const { args } = fitLimeArgs(project, result.mode, result.tags.join(','))
    assert.ok(args.includes(`--project=${project}`))
    assert.ok(args.includes('--workers=2'))
    assert.equal(args.at(-1), '--grep=@lime-(critical|finance)\\b')
    assert.ok(!args.some(arg => arg.includes('pass-with-no-tests') || arg.includes('retries')))
  }
})

test('unions independently affected features instead of selecting only the first', () => {
  assert.deepEqual(selectFitLimeScope([finance, 'src/features/clients/GoalPages.test.tsx'], activePr).tags,
    ['critical', 'finance', 'goals'])
})

test('every supported feature has a small explicit file scope', () => {
  const files = {
    templates: 'src/features/workout-templates/workout-template-draft.ts',
    clients: 'src/features/clients/ClientsListPage.tsx', goals: 'src/features/clients/GoalPages.tsx',
    progress: 'src/features/progress/ProgressPages.tsx', profile: 'src/features/profile/ProfilePage.test.tsx',
    chat: 'src/features/chat/ChatPages.tsx', exercises: 'src/features/exercises/ExercisesPage.tsx',
    duration: 'src/features/workouts/WorkoutActualDuration.tsx',
  }
  for (const [tag, path] of Object.entries(files)) assert.deepEqual(selectFitLimeScope([path], activePr).tags, ['critical', tag].sort())
})

test('shared contracts, auth, navigation, styles and unknown changes fail closed', () => {
  for (const path of ['src/styles.css', 'src/app/routes.tsx', 'src/app/feature-flags.ts',
    'src/features/auth/LoginPage.tsx', 'src/shared/ui.tsx', 'src/data/repositories/trainer-finance.repository.ts',
    'src/features/workouts/LivePage.tsx', 'src/features/exercises/ExercisePicker.tsx',
    'src/features/finance/NewUnknownPage.tsx', 'src/features/clients/ClientPortalPages.tsx',
    'src/features/profile/index.ts', 'src/features/nutrition/nutrition.css', 'src/features/chat/chat-image.ts',
    'services/api/src/server.ts', 'supabase/migrations/existing.sql', 'package-lock.json',
    ...reviewedInventoryFiles, '.github/workflows/ci.yml', 'scripts/fit-lime-ci-scope.mjs']) {
    assert.equal(selectFitLimeScope([finance, path], activePr).mode, 'full', path)
  }
})

test('push, manual, missing and unexpected events never narrow release acceptance', () => {
  for (const eventName of ['push', 'workflow_dispatch', '', undefined, 'schedule']) {
    assert.equal(selectFitLimeScope([finance], { ...activePr, eventName }).mode, 'full')
  }
})

test('expiry is fail-closed at Moscow midnight, not just after the day', () => {
  assert.equal(selectFitLimeScope([finance], { ...activePr, now: new Date(Date.parse(scopedPrExpiresAt) - 1) }).mode, 'scoped')
  for (const now of [new Date(scopedPrExpiresAt), new Date('2026-10-26T12:00:00Z'), new Date('2026-10-11'), new Date('invalid')]) {
    assert.equal(selectFitLimeScope([finance], { ...activePr, now }).mode, 'full')
  }
})

test('missing, changed inventory and unverified diffs never narrow the suite', () => {
  for (const inventoryDigest of [undefined, '', 'changed']) assert.equal(selectFitLimeScope([finance], { ...activePr, inventoryDigest }).mode, 'full')
  assert.equal(selectFitLimeScope([], activePr).mode, 'full')
  assert.equal(selectFitLimeScope(['docs/README.md'], activePr).mode, 'full')
  assert.equal(selectFitLimeScope(['.github/workflows/deploy-cloudru-stage.yml'], activePr).mode, 'full')
})

test('actual spec edits switch to full without requiring an automatic digest refresh', () => {
  const digest = fitLimeInventoryDigest()
  assert.equal(selectFitLimeScope([finance], { ...activePr, inventoryDigest: digest }).mode,
    digest === reviewedInventoryDigest ? 'scoped' : 'full')
  const sources = reviewedInventoryFiles.map(path => readFileSync(new URL(`../${path}`, import.meta.url)))
  for (let i = 0; i < sources.length; i++) {
    const changed = sources.map((source, index) => index === i ? Buffer.concat([source, Buffer.from('\n// future test change')]) : source)
    assert.equal(selectFitLimeScope([finance], { ...activePr, inventoryDigest: fitLimeInventoryDigest(changed) }).mode, 'full')
  }
  assert.throws(() => fitLimeInventoryDigest([]))
})

test('production frontend accepts only successful current-main push/manual CI, never scoped PR CI', () => {
  const deployment = readFileSync(new URL('../.github/workflows/deploy-yandex-frontend.yml', import.meta.url), 'utf8')
  assert.match(deployment, /\.head_branch == "main"/)
  assert.match(deployment, /\(\.event == "push" or \.event == "workflow_dispatch"\)/)
  assert.match(deployment, /\.status == "completed" and \.conclusion == "success"/)
  assert.match(deployment, /test "\$commit" = "\$\(gh api "repos\/\$GITHUB_REPOSITORY\/commits\/main" --jq \.sha\)"/)
})

test('full mode keeps all cases without grep, shard, timeout or retry changes', () => {
  assert.deepEqual(fitLimeArgs('lime-acceptance-webkit', 'full').args,
    ['test', 'e2e/fit-lime.behavior.spec.ts', 'e2e/trainer-schedule-v2.visual.spec.ts', '--project=lime-acceptance-webkit', '--workers=2'])
})

test('runner rejects empty, unknown, duplicate, partial or injected selectors', () => {
  for (const tags of ['', 'critical', 'finance', 'critical,new-feature', 'critical,finance,finance', 'critical,finance|.*']) {
    assert.throws(() => fitLimeArgs('mobile-chromium', 'scoped', tags))
  }
  assert.throws(() => fitLimeArgs('unknown', 'full'))
  assert.throws(() => fitLimeArgs('mobile-chromium', 'full', 'critical,finance'))
  assert.throws(() => fitLimeArgs('mobile-chromium', 'unknown'))
})

test('disabled acceptance cannot turn either full or scoped mode into a skipped green job', () => {
  for (const mode of ['full', 'scoped']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-fit-lime-ci.mjs', import.meta.url)),
      'mobile-chromium', mode, ...(mode === 'scoped' ? ['critical,finance'] : [])], {
      env: { ...process.env, FIT_SCHEDULE_V2_VISUAL: '0' }, encoding: 'utf8', timeout: 10000,
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /acceptance must be enabled/)
  }
})

test('inventory requires critical and every affected feature, with no zero-case success', () => {
  const report = { suites: [{ specs: [{ tags: ['lime-critical'] }], suites: [{ specs: [{ tags: ['lime-finance', 'lime-critical'] }] }] }] }
  assert.equal(validateFitLimeInventory(report, ['critical', 'finance']), 2)
  assert.throws(() => validateFitLimeInventory(report, ['critical', 'goals']))
  assert.throws(() => validateFitLimeInventory({ suites: [] }, ['critical', 'finance']))
  assert.throws(() => validateFitLimeInventory({ ...report, errors: [{ message: 'collection failed' }] }, ['critical', 'finance']))
})
