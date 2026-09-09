import assert from 'node:assert/strict'
import { test } from 'node:test'

import { requiresE2E } from './e2e-scope.mjs'

test('skips the browser runtime for explicit non-browser scopes', () => {
  assert.equal(requiresE2E([
    'docs/CURRENT_STATE.md',
    'infra/yandex/stage/main.tf',
    'services/api/src/server.ts',
    'services/api/src/server.test.ts',
    'services/api/package-lock.json',
    '.github/workflows/deploy-yandex-stage.yml',
    'OPERATIONS.md',
    'scripts/check-yandex-terraform-plan.mjs',
    'scripts/check-yandex-terraform-plan.test.mjs',
    'scripts/deploy-yandex-serverless-revision.mjs',
    'scripts/deploy-yandex-serverless-revision.test.mjs',
    'scripts/deploy-yandex-stage-workflow.mjs',
    'scripts/deploy-yandex-stage-workflow.test.mjs',
    'scripts/e2e-scope.mjs',
    'scripts/e2e-scope.test.mjs',
    'scripts/verify-yandex-stage-access.mjs',
    'scripts/verify-yandex-stage-access.test.mjs',
    'vercel.json',
  ]), false)
})

test('runs E2E for browser application, Supabase, dependency and CI changes', () => {
  for (const path of [
    'src/features/today/TodayPage.tsx',
    'e2e/today-start.spec.ts',
    'supabase/migrations/20260825000000_example.sql',
    'package-lock.json',
    'playwright.config.ts',
    '.github/workflows/ci.yml',
  ]) {
    assert.equal(requiresE2E([path]), true, path)
  }
})

test('runs E2E defensively when a diff contains no paths', () => {
  assert.equal(requiresE2E([]), true)
})
