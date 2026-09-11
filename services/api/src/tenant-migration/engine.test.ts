import { describe, expect, it, vi } from 'vitest'

import type { DatabaseClient } from '../db/types.js'
import {
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
    expect(bundle.tables).toHaveLength(30)
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

  it('uses an independent advisory lock and rolls a validated dry-run back', async () => {
    const source = buildSource(standalonePreflight())
    const bundle = await exportStandaloneClient(source.client, CLIENT_PROFILE_ID)
    const query = vi.fn(() => Promise.resolve([]))
    const target: DatabaseClient = { query }

    const report = await importTenant(target, bundle, false)

    expect(report.mode).toBe('dry-run')
    expect(report.tables).toHaveLength(30)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("'fit-tenant:' || $1 || ':' || $2"),
      ['standalone-client', CLIENT_PROFILE_ID],
    )
    expect(query).toHaveBeenCalledWith('rollback')
  })
})
