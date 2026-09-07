import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  assertIdempotentApply,
  assertLocalDatabaseUrl,
  assertProductionLikeManifest,
  assertRehearsalDatabaseName,
  EXPECTED_EMPTY_TABLES,
  parseExportSummary,
  parseMigrationReport,
  PRODUCTION_LIKE_TABLES,
} from './run-local-tenant-rehearsal.mjs'

function exportOutput(overrides = new Map()) {
  const rows = [
    ...PRODUCTION_LIKE_TABLES.map((name) => [name, 1]),
    ...EXPECTED_EMPTY_TABLES.map((name) => [name, 0]),
  ].map(([name, defaultRows]) => (
    `${name}: rows=${overrides.get(name) ?? defaultRows}`
  ))
  return `exported: tenant da877b834123f5a0; 28 tables\n${rows.join('\n')}\n`
}

function reportOutput(mode, inserted = 0) {
  const rows = [...PRODUCTION_LIKE_TABLES, ...EXPECTED_EMPTY_TABLES]
    .map((name) => `${name}: rows=1, inserted=${inserted}`)
  return `${mode}: tenant da877b834123f5a0; 28 tables\n${rows.join('\n')}\n`
}

describe('local tenant rehearsal safety', () => {
  test('accepts only process-scoped rehearsal database names', () => {
    assert.equal(
      assertRehearsalDatabaseName('fit_tenant_rehearsal_123_1'),
      'fit_tenant_rehearsal_123_1',
    )
    for (const unsafe of [
      'fit_actor_test',
      'postgres',
      'fit_tenant_rehearsal_123_3',
      'fit_tenant_rehearsal_123_1;drop database fit',
    ]) {
      assert.throws(
        () => assertRehearsalDatabaseName(unsafe),
        /unsafe_rehearsal_database_name/u,
      )
    }
  })

  test('accepts only the expected loopback PostgreSQL endpoint', () => {
    assert.equal(
      assertLocalDatabaseUrl(
        'postgresql://postgres:postgres@127.0.0.1:55432/local',
        '55432',
      ),
      'postgresql://postgres:postgres@127.0.0.1:55432/local',
    )
    assert.throws(
      () => assertLocalDatabaseUrl(
        'postgresql://postgres:secret@database.example:5432/fit',
        '55432',
      ),
      /remote_database_url_rejected/u,
    )
    assert.throws(
      () => assertLocalDatabaseUrl(
        'postgresql://postgres:postgres@127.0.0.1:5432/fit',
        '55432',
      ),
      /remote_database_url_rejected/u,
    )
  })

  test('requires data in every transferable production-like table', () => {
    const summary = parseExportSummary(exportOutput())
    assert.doesNotThrow(() => assertProductionLikeManifest(summary))

    const emptyWorkouts = parseExportSummary(
      exportOutput(new Map([['public.workouts', 0]])),
    )
    assert.throws(
      () => assertProductionLikeManifest(emptyWorkouts),
      /production_like_table_empty:public\.workouts/u,
    )
  })

  test('requires target-only operational tables to remain empty', () => {
    const nonEmptyOutbox = parseExportSummary(
      exportOutput(new Map([['app_private.push_notifications_outbox', 1]])),
    )
    assert.throws(
      () => assertProductionLikeManifest(nonEmptyOutbox),
      /target_only_table_not_empty:app_private\.push_notifications_outbox/u,
    )
  })

  test('parses all report modes and rejects a non-idempotent repeat', () => {
    for (const mode of ['dry-run', 'applied', 'validated']) {
      assert.equal(parseMigrationReport(reportOutput(mode), mode).tables.size, 28)
    }
    assert.doesNotThrow(() => {
      assertIdempotentApply(parseMigrationReport(reportOutput('applied'), 'applied'))
    })
    assert.throws(
      () => assertIdempotentApply(
        parseMigrationReport(reportOutput('applied', 1), 'applied'),
      ),
      /repeated_apply_inserted_rows/u,
    )
  })

  test('rejects incomplete, duplicated and mismatched reports', () => {
    assert.throws(
      () => parseExportSummary(
        exportOutput().replace('28 tables', '27 tables'),
      ),
      /migration_manifest_count_invalid/u,
    )
    const duplicated = `${exportOutput()}public.profiles: rows=1\n`
    assert.throws(
      () => parseExportSummary(duplicated),
      /migration_output_invalid/u,
    )
    assert.throws(
      () => parseMigrationReport(reportOutput('dry-run'), 'applied'),
      /migration_report_output_invalid/u,
    )
  })
})
