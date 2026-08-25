import assert from 'node:assert/strict'
import { test } from 'node:test'

import { requiresE2E } from './e2e-scope.mjs'

test('skips the browser runtime only for explicit documentation and deployment infrastructure', () => {
  assert.equal(requiresE2E([
    'docs/CURRENT_STATE.md',
    'infra/yandex/stage/main.tf',
    '.github/workflows/deploy-yandex-stage.yml',
    'vercel.json',
  ]), false)
})

test('runs E2E for application, database, dependency and CI changes', () => {
  for (const path of [
    'src/features/today/TodayPage.tsx',
    'e2e/today-start.spec.ts',
    'supabase/migrations/20260825000000_example.sql',
    'package-lock.json',
    'playwright.config.ts',
    '.github/workflows/ci.yml',
    'services/api/src/server.ts',
  ]) {
    assert.equal(requiresE2E([path]), true, path)
  }
})

test('runs E2E defensively when a diff contains no paths', () => {
  assert.equal(requiresE2E([]), true)
})
