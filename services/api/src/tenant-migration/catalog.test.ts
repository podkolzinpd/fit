import { describe, expect, it } from 'vitest'

import {
  STANDALONE_CLIENT_MIGRATION_TABLES,
  STANDALONE_CLIENT_SOURCE_PREFLIGHT_SQL,
  TENANT_MIGRATION_TABLES,
} from './catalog.js'

function expectSafeManifest(
  manifest: typeof TENANT_MIGRATION_TABLES,
): void {
  expect(manifest).toHaveLength(30)
  const names = manifest.map((spec) => spec.name)
  expect(new Set(names).size).toBe(names.length)
  for (const spec of manifest) {
    expect(spec.name).toBe(spec.targetRecord)
    expect(spec.sourceSql).toContain('$1')
    expect(spec.targetSql).toContain('$1')
    expect(spec.targetRecord).toMatch(/^(public|app_private)\.[a-z_]+$/)
    for (const keyColumn of spec.keyColumns ?? ['id']) {
      expect(keyColumn).toMatch(/^[a-z_]+$/)
    }
  }
}

describe('tenant migration catalog', () => {
  it('keeps a unique, parameterized and identifier-safe manifest', () => {
    expectSafeManifest(TENANT_MIGRATION_TABLES)
    expectSafeManifest(STANDALONE_CLIENT_MIGRATION_TABLES)
    expect(STANDALONE_CLIENT_MIGRATION_TABLES.map((spec) => spec.name))
      .toEqual(TENANT_MIGRATION_TABLES.map((spec) => spec.name))
  })

  it('maps source-only fields and requires target-only receipts to be empty', () => {
    const byName = new Map(
      TENANT_MIGRATION_TABLES.map((spec) => [spec.name, spec]),
    )
    expect(byName.get('public.client_trainers')?.sourceSql)
      .toContain('client_private_details')
    expect(byName.get('public.client_custom_metrics')?.sourceSql)
      .toContain("'created_by'")
    expect(byName.get('public.goal_stages')?.sourceSql)
      .toContain("'created_by'")
    expect(byName.get('public.client_published_training_summaries')?.sourceSql)
      .toContain("'input_fingerprint'")
    expect(byName.get('public.app_feedback')?.sourceSql)
      .toContain("'tracker_request_id'")
    expect(byName.get('public.app_feedback')?.sourceSql)
      .not.toContain("- 'tracker_issue_key'")
    expect(byName.get('public.app_feedback')?.sourceSql)
      .not.toContain("- 'telegram_notified_at'")
    expect(byName.get('public.push_subscriptions')?.keyColumns)
      .toEqual(['id'])
    expect(byName.get('app_private.workout_create_requests')?.sourceSql)
      .toContain("'actor_id'")

    for (const name of [
      'app_private.push_notifications_outbox',
      'app_private.live_workout_operations',
    ]) {
      expect(byName.get(name)?.sourceSql).toContain('where $1::uuid is null')
    }
  })

  it('keeps standalone clients unlinked while preserving historical references', () => {
    const byName = new Map(
      STANDALONE_CLIENT_MIGRATION_TABLES.map((spec) => [spec.name, spec]),
    )
    expect(byName.get('public.profiles')?.sourceSql).toContain('scope_users')
    expect(byName.get('public.custom_exercises')?.sourceSql)
      .toContain('scope_custom_exercises')
    expect(byName.get('public.chat_conversations')?.sourceSql)
      .toContain('scope_conversations')
    expect(STANDALONE_CLIENT_SOURCE_PREFLIGHT_SQL)
      .toContain('relationship.status = \'active\'')
    expect(STANDALONE_CLIENT_SOURCE_PREFLIGHT_SQL)
      .toContain('has_membership')
    expect(STANDALONE_CLIENT_SOURCE_PREFLIGHT_SQL)
      .toContain('message.image_path is not null')
  })
})
