import { describe, expect, it, vi } from 'vitest'

import type { DatabaseClient } from '../db/types.js'
import {
  exportFullCohort,
  exportStandaloneClient,
  importTenant,
  TenantMigrationError,
} from './engine.js'

const CLIENT_PROFILE_ID = '30000000-0000-4000-8000-000000000003'

function standalonePreflight(
  overrides: Partial<Record<string, boolean | number>> = {},
): Record<string, boolean | number> {
  return {
    client_profile_exists: true,
    owned_client_count: 1,
    has_non_standalone_root: false,
    has_membership: false,
    has_active_relationship: false,
    has_cross_boundary_merge: false,
    has_pending_push: false,
    has_chat_media: false,
    ...overrides,
  }
}

function buildSource(
  preflight: Record<string, boolean | number>,
): { client: DatabaseClient; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn((sql: string) => {
    if (sql.includes('as client_profile_exists')) {
      return Promise.resolve([preflight])
    }
    return Promise.resolve([])
  })
  return { client: { query: query as DatabaseClient['query'] }, query }
}

describe('standalone client tenant migration', () => {
  it('exports a profile-only or self-owned client without a trainer membership', async () => {
    const source = buildSource(standalonePreflight({ owned_client_count: 0 }))

    const bundle = await exportStandaloneClient(
      source.client,
      CLIENT_PROFILE_ID,
      new Date('2026-09-11T12:00:00.000Z'),
    )

    expect(bundle).toMatchObject({
      format: 'fit-standalone-client-bundle-v1',
      clientProfileId: CLIENT_PROFILE_ID,
      createdAt: '2026-09-11T12:00:00.000Z',
    })
    expect(bundle.tables).toHaveLength(34)
    expect(source.query).toHaveBeenCalledWith('commit')
  })

  it.each([
    ['standalone_client_partition_not_owned', { has_non_standalone_root: true }],
    ['standalone_client_has_active_trainer', { has_membership: true }],
    ['standalone_client_has_active_trainer', { has_active_relationship: true }],
    ['tenant_merge_crosses_boundary', { has_cross_boundary_merge: true }],
    ['tenant_has_pending_push', { has_pending_push: true }],
    ['standalone_client_has_chat_media', { has_chat_media: true }],
  ])('rejects unsafe source state: %s', async (code, overrides) => {
    const source = buildSource(standalonePreflight(overrides))

    await expect(exportStandaloneClient(source.client, CLIENT_PROFILE_ID))
      .rejects.toEqual(new TenantMigrationError(code))
    expect(source.query).toHaveBeenCalledWith('rollback')
  })

  it('serializes imports, locks the root and rolls a validated dry-run back', async () => {
    const source = buildSource(standalonePreflight())
    const bundle = await exportStandaloneClient(source.client, CLIENT_PROFILE_ID)
    const query = vi.fn(() => Promise.resolve([]))
    const target: DatabaseClient = { query }

    const report = await importTenant(target, bundle, false)

    expect(report.mode).toBe('dry-run')
    expect(report.tables).toHaveLength(34)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("hashtextextended('fit-tenant:migration', 0)"),
    )
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("'fit-tenant:' || $1 || ':' || $2"),
      ['standalone-client', CLIENT_PROFILE_ID],
    )
    expect(query).toHaveBeenCalledWith('rollback')
  })
})

describe('full application cohort migration', () => {
  function buildFullSource(
    overrides: Partial<FullCohortPreflight> = {},
  ): { client: DatabaseClient; query: ReturnType<typeof vi.fn> } {
    const preflight: FullCohortPreflight = {
      cohort_exists: true,
      ...overrides,
    }
    const query = vi.fn((sql: string) => {
      if (sql.includes('as cohort_exists')) return Promise.resolve([preflight])
      return Promise.resolve([])
    })
    return { client: { query: query as DatabaseClient['query'] }, query }
  }

  interface FullCohortPreflight {
    cohort_exists: boolean
  }

  it('exports all manifest tables without evaluating tenant boundaries', async () => {
    const source = buildFullSource()
    const bundle = await exportFullCohort(
      source.client,
      new Date('2026-09-14T10:00:00.000Z'),
    )

    expect(bundle).toMatchObject({
      format: 'fit-full-cohort-bundle-v1',
      createdAt: '2026-09-14T10:00:00.000Z',
    })
    expect(bundle.tables).toHaveLength(34)
    expect(source.query).not.toHaveBeenCalledWith(
      expect.stringContaining('has_cross_boundary_merge'),
      expect.anything(),
    )
    expect(source.query).not.toHaveBeenCalledWith(
      expect.stringContaining('has_pending_push'),
      expect.anything(),
    )
    expect(source.query).toHaveBeenCalledWith('commit')
  })

  it.each([
    ['full_cohort_empty', { cohort_exists: false }],
  ])('rejects an unsafe complete snapshot: %s', async (code, overrides) => {
    const source = buildFullSource(overrides)
    await expect(exportFullCohort(source.client)).rejects.toEqual(
      new TenantMigrationError(code),
    )
    expect(source.query).toHaveBeenCalledWith('rollback')
  })

  function fullCohortBundleWithProfile() {
    const sourceQuery = vi.fn((sql: string) => {
      if (sql.includes('as cohort_exists')) {
        return Promise.resolve([{
          cohort_exists: true,
        }])
      }
      if (sql.includes('from public.profiles row')) {
        return Promise.resolve([{
          row: { id: CLIENT_PROFILE_ID, timezone: 'Europe/Moscow' },
        }])
      }
      return Promise.resolve([])
    }) as unknown as DatabaseClient['query']
    return exportFullCohort({ query: sourceQuery })
  }

  it('atomically replaces a complete cohort and overwrites changed rows', async () => {
    const bundle = await fullCohortBundleWithProfile()
    const targetQuery = vi.fn((sql: string) => {
      if (sql.includes('as has_native_identity')) {
        return Promise.resolve([{
          has_native_identity: false,
          has_missing_anchor: false,
        }])
      }
      if (
        sql.includes('select to_jsonb(existing)')
        && sql.includes('from public.profiles existing')
      ) {
        return Promise.resolve([{
          row: {
            id: CLIENT_PROFILE_ID,
            timezone: 'Europe/Moscow',
            target_only_default: true,
          },
        }])
      }
      return Promise.resolve([])
    }) as unknown as DatabaseClient['query']
    await expect(importTenant({ query: targetQuery }, bundle, false))
      .resolves.toMatchObject({ mode: 'dry-run' })
    expect(targetQuery).toHaveBeenCalledWith(
      expect.stringContaining('delete from public.trainer_professional_profiles'),
    )
    expect(targetQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into public.profiles'),
      [JSON.stringify(bundle.tables[0]?.rows)],
    )
    expect(targetQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into app_private.auth_identities'),
    )
    expect(targetQuery).toHaveBeenCalledWith('rollback')
  })

  it('validates the exact rebuilt cohort and rejects extra target rows', async () => {
    const bundle = await fullCohortBundleWithProfile()
    const targetQuery = vi.fn((sql: string) => {
      if (sql.includes('as has_native_identity')) {
        return Promise.resolve([{
          has_native_identity: false,
          has_missing_anchor: false,
        }])
      }
      if (
        sql.includes('select to_jsonb(existing)')
        && sql.includes('from public.profiles existing')
      ) {
        return Promise.resolve([{
          row: { id: CLIENT_PROFILE_ID, timezone: 'Europe/Moscow' },
        }, {
          row: {
            id: '40000000-0000-4000-8000-000000000004',
            timezone: 'UTC',
          },
        }])
      }
      return Promise.resolve([])
    }) as unknown as DatabaseClient['query']
    await expect(importTenant({ query: targetQuery }, bundle, false))
      .rejects.toEqual(
        new TenantMigrationError('target_validation_failed:public.profiles'),
      )
    expect(targetQuery).toHaveBeenCalledWith('rollback')
  })

  it.each([
    [
      'full_cohort_target_has_native_identity',
      { has_native_identity: true, has_missing_anchor: false },
    ],
    [
      'full_cohort_target_anchor_missing_from_snapshot',
      { has_native_identity: false, has_missing_anchor: true },
    ],
  ])('refuses an unsafe target before deleting rows: %s', async (code, row) => {
    const bundle = await fullCohortBundleWithProfile()
    const targetQuery = vi.fn((sql: string) => {
      if (sql.includes('as has_native_identity')) return Promise.resolve([row])
      return Promise.resolve([])
    }) as unknown as DatabaseClient['query']

    await expect(importTenant({ query: targetQuery }, bundle, true))
      .rejects.toEqual(new TenantMigrationError(code))
    expect(targetQuery).not.toHaveBeenCalledWith(
      expect.stringMatching(/^delete from /u),
    )
    expect(targetQuery).toHaveBeenCalledWith('rollback')
  })
})
