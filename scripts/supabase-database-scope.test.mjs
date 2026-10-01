import assert from 'node:assert/strict'
import { test } from 'node:test'

import { requiresSupabaseDatabase, shouldRunSupabaseDatabase } from './supabase-database-scope.mjs'

test('runs legacy database checks when their schema, tests, or local setup change', () => {
  for (const path of [
    'supabase/migrations/20260825000000_example.sql',
    'supabase/tests/0001_schema.test.sql',
    'supabase/config.toml',
    'supabase/seed.sql',
  ]) {
    assert.equal(requiresSupabaseDatabase([path]), true, path)
  }
})

test('skips legacy database checks for unrelated PRs, including Yandex migrations', () => {
  assert.equal(requiresSupabaseDatabase([
    'services/api/db/migrations/000126_yandex_example.sql',
    'src/features/auth/AuthPages.tsx',
    'supabase/functions/parse-workout/index.ts',
    'docs/CURRENT_STATE.md',
  ]), false)
  assert.equal(requiresSupabaseDatabase([]), false)
})

test('manual runs and unavailable diffs fail open into the legacy database check', () => {
  assert.equal(shouldRunSupabaseDatabase('workflow_dispatch', []), true)
  assert.equal(shouldRunSupabaseDatabase('pull_request', null), true)
  assert.equal(shouldRunSupabaseDatabase('push', null), true)
  assert.equal(shouldRunSupabaseDatabase('pull_request', ['src/app/App.tsx']), false)
})
