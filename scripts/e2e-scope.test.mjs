import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { changedPaths, requiresE2E, selectCheckScope } from './e2e-scope.mjs'

test('skips the browser runtime for explicit non-browser scopes', () => {
  assert.equal(requiresE2E([
    'docs/CURRENT_STATE.md',
    'services/api/src/cloudru-backup.ts',
    'services/api/src/workout-home-reader.test.ts',
    'services/speechkit-relay/cloudru-server.test.mjs',
    '.github/workflows/inspect-cloudru-operations.yml',
    '.github/workflows/maintain-cloudru-runner-disk.yml',
    'scripts/cloudru-stabilization-workflows.test.mjs',
    'scripts/cloudru-runner-disk-workflow.test.mjs',
    '.github/workflows/deploy-yandex-stage.yml',
    '.github/workflows/deploy-cloudru-stage.yml',
    '.github/workflows/migrate-yandex-database-to-cloudru.yml',
    '.github/workflows/migrate-yandex-media-to-cloudru.yml',
    '.github/workflows/transfer-yandex-sql-to-cloudru.yml',
    '.github/workflows/manage-cloudru-recovery-push.yml',
    '.github/workflows/manage-yandex-stage-identity-unlink.yml',
    'OPERATIONS.md',
    'scripts/check-yandex-terraform-plan.mjs',
    'scripts/check-yandex-terraform-plan.test.mjs',
    'scripts/check-yandex-migration-container-plan.mjs',
    'scripts/check-yandex-migration-container-plan.test.mjs',
    'scripts/domain-change-push-workflow.test.mjs',
    'scripts/cloudru-media-migration-workflow.test.mjs',
    'scripts/deploy-yandex-serverless-revision.mjs',
    'scripts/deploy-yandex-serverless-revision.test.mjs',
    'scripts/deploy-yandex-stage-workflow.mjs',
    'scripts/deploy-yandex-stage-workflow.test.mjs',
    'scripts/cloudru-speech-diagnostics.py',
    'scripts/cloudru-speech-diagnostics.test.py',
    'scripts/verify-yandex-stage-access.mjs',
    'scripts/verify-yandex-stage-access.test.mjs',
    'scripts/yandex-stage-smoke.mjs',
  ]), false)
})

test('runs E2E for browser application, Supabase, dependency and CI changes', () => {
  for (const path of [
    'src/features/today/TodayPage.tsx',
    'e2e/today-start.spec.ts',
    'supabase/migrations/20260825000000_example.sql',
    'package-lock.json',
    'package.json',
    'scripts/unknown-browser-helper.mjs',
    'playwright.config.ts',
    '.github/workflows/ci.yml',
    '.github/workflows/deploy-cloudru-frontend.yml',
    'scripts/e2e-scope.mjs',
    'scripts/e2e-scope.test.mjs',
    'scripts/ci-workflow.test.mjs',
    'scripts/promote-cloudru-speech.sh',
    'infra/yandex/stage/main.tf',
    'infra/yandex-frontend/main.tf',
    'infra/cloudru/web.conf',
    'services/api/src/server.ts',
    'services/api/src/server.test.ts',
    'services/api/src/yandex-auth.test.ts',
    'services/api/src/cors-origins.ts',
    'services/api/src/new-module.ts',
    'services/api/package-lock.json',
    'services/speechkit-relay/cloudru-server.mjs',
    'vercel.json',
  ]) {
    assert.equal(requiresE2E([path]), true, path)
  }
})

test('runs E2E defensively when a diff contains no paths', () => {
  assert.equal(requiresE2E([]), true)
})

test('docs assets and data are frontend inputs, not prose-only changes', () => {
  for (const path of [
    'docs/design/figma-20261002/assets/plus.svg',
    'docs/design/figma-20261008/assets/coach-rest.svg',
    'docs/design/achievement-art-source/regularity.png',
    'docs/design/build-input.json',
  ]) {
    const scope = selectCheckScope([path, 'docs/CURRENT_STATE.md'], { eventName: 'pull_request' })
    assert.equal(scope.frontendRequired, true, path)
    assert.equal(scope.browserRequired, true, path)
  }
})

test('PR frontend and browser scope share the same reviewed policy and per-file reasons', () => {
  const paths = ['docs/CURRENT_STATE.md', '.github/workflows/inspect-cloudru-operations.yml', 'scripts/cloudru-stabilization-workflows.test.mjs']
  const scope = selectCheckScope(paths, { eventName: 'pull_request' })
  assert.equal(scope.frontendRequired, false)
  assert.equal(scope.browserRequired, false)
  assert.deepEqual(scope.decisions.map(item => item.path), paths)
  assert(scope.decisions.every(item => item.category && item.required === false))
  // A single frontend/shared path overrides all non-frontend paths.
  const mixed = selectCheckScope([...paths, 'src/styles.css'], { eventName: 'pull_request' })
  assert.equal(mixed.frontendRequired, true)
  assert.equal(mixed.browserRequired, true)
  assert.equal(mixed.decisions.at(-1).required, true)
})

test('main, manual and unknown events always keep full release acceptance', () => {
  for (const eventName of ['push', 'workflow_dispatch', 'pull_request_target', '', undefined]) {
    const scope = selectCheckScope(['docs/README.md'], { eventName })
    assert.equal(scope.frontendRequired, true, String(eventName))
    assert.equal(scope.browserRequired, true, String(eventName))
  }
})

test('missing history and malformed paths cannot authorize a skip', () => {
  for (const paths of [[], null, undefined, ['docs/../src/a.ts'], ['docs//a.md'], ['docs/a.md\nsrc/a.ts'], ['/docs/a.md'], ['docs\\a.md'], [null]]) {
    assert.equal(selectCheckScope(paths, { eventName: 'pull_request' }).frontendRequired, true)
    assert.equal(requiresE2E(paths), true)
  }
  for (const [base, head] of [['', 'abcd1234'], ['00000000', 'abcd1234'], ['--help', 'abcd1234'], ['abcdef12', 'deadbeef']]) {
    assert.deepEqual(changedPaths(base, head), [])
  }
})

test('real Git diff exposes both rename paths, handles divergence and emits safe CI outputs', () => {
  const script = resolve(import.meta.dirname, 'e2e-scope.mjs')
  const directory = mkdtempSync(join(tmpdir(), 'fit-check-scope-'))
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = message => {
    git('add', '--all')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  try {
    git('init', '-b', 'main')
    mkdirSync(join(directory, 'src'))
    mkdirSync(join(directory, 'docs'))
    writeFileSync(join(directory, 'src', 'example.ts'), 'export const value = 1\n')
    const base = commit('Fixture base')
    git('switch', '-c', 'fixture-docs')
    writeFileSync(join(directory, 'docs', 'README.md'), 'Fixture documentation\n')
    const docsHead = commit('Fixture docs')
    git('switch', 'main')
    writeFileSync(join(directory, 'src', 'example.ts'), 'export const value = 2\n')
    const advancedBase = commit('Fixture main advancement')
    const run = (baseSha, headSha) => spawnSync(process.execPath, [script, baseSha, headSha, '--json'], {
      cwd: directory, encoding: 'utf8', env: { ...process.env, EVENT_NAME: 'pull_request',
        GITHUB_OUTPUT: join(directory, '.git', 'outputs'), GITHUB_STEP_SUMMARY: join(directory, '.git', 'summary') },
    })
    const docs = run(advancedBase, docsHead)
    assert.equal(docs.status, 0, docs.stderr)
    assert.equal(JSON.parse(docs.stdout).frontendRequired, false)
    assert.deepEqual(JSON.parse(docs.stdout).decisions.map(item => item.path), ['docs/README.md'])
    assert.match(readFileSync(join(directory, '.git', 'outputs'), 'utf8'), /required=false\nfrontend_required=false\n/)
    assert.match(readFileSync(join(directory, '.git', 'summary'), 'utf8'), /Automatic PR check scope/)
    mkdirSync(join(directory, 'docs'), { recursive: true })
    git('mv', 'src/example.ts', 'docs/example.md')
    const renameHead = commit('Fixture rename')
    const renamed = JSON.parse(run(base, renameHead).stdout)
    assert.equal(renamed.frontendRequired, true)
    assert.deepEqual(renamed.decisions.map(item => item.path), ['docs/example.md', 'src/example.ts'])
    writeFileSync(join(directory, 'docs', '<unsafe>.md'), 'Fixture\n')
    const unusualHead = commit('Fixture unusual name')
    assert.equal(run(renameHead, unusualHead).status, 0)
    const summary = readFileSync(join(directory, '.git', 'summary'), 'utf8')
    assert.match(summary, /&lt;unsafe&gt;\.md/)
    assert.doesNotMatch(summary, /<unsafe>/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
