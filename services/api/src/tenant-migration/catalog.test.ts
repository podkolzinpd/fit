import { describe, expect, it } from 'vitest'

import { TENANT_MIGRATION_TABLES } from './catalog.js'

describe('tenant migration catalog', () => {
  it('keeps a unique, parameterized and identifier-safe manifest', () => {
    expect(TENANT_MIGRATION_TABLES).toHaveLength(28)
    const names = TENANT_MIGRATION_TABLES.map((spec) => spec.name)
    expect(new Set(names).size).toBe(names.length)
    for (const spec of TENANT_MIGRATION_TABLES) {
      expect(spec.name).toBe(spec.targetRecord)
      expect(spec.sourceSql).toContain('$1')
      expect(spec.targetSql).toContain('$1')
      expect(spec.targetRecord).toMatch(/^(public|app_private)\.[a-z_]+$/)
      for (const keyColumn of spec.keyColumns ?? ['id']) {
        expect(keyColumn).toMatch(/^[a-z_]+$/)
      }
    }
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
      .toContain("'tracker_issue_key'")
    expect(byName.get('app_private.workout_create_requests')?.sourceSql)
      .toContain("'actor_id'")

    for (const name of [
      'app_private.push_notifications_outbox',
      'app_private.live_workout_operations',
    ]) {
      expect(byName.get(name)?.sourceSql).toContain('where $1::uuid is null')
    }
  })
})
