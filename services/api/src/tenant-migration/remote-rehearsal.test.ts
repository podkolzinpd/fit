import { describe, expect, it, vi } from 'vitest'

import type { DatabaseClient } from '../db/types.js'
import { TenantMigrationError } from './engine.js'
import {
  buildSupabaseSourceConfig,
  exportSelectedTenant,
  formatStageConflictDiagnostics,
  isStageTenantConflict,
  readStageTenantConflictCode,
  readSourceDatabaseFailureCode,
  readRemoteTenantRehearsalSettings,
  requireExpectedTenantFingerprint,
  readStageTenantMigrationRejectionCode,
  readStageTenantMigrationResponse,
  RemoteTenantRehearsalError,
} from './remote-rehearsal.js'
import type { TenantMigrationBundle } from './types.js'

const TRAINER_ID = '10000000-0000-4000-8000-000000000001'
const SECOND_TRAINER_ID = '20000000-0000-4000-8000-000000000002'
const CLIENT_PROFILE_ID = '30000000-0000-4000-8000-000000000003'
const PROJECT_ID = 'abcdefghijklmnopqrst'
const SOURCE_ENVIRONMENT = {
  FIT_TENANT_REHEARSAL_MODE: 'audit',
  FIT_TENANT_SOURCE_POOLER_URL:
    `postgresql://postgres.${PROJECT_ID}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
  FIT_TENANT_SOURCE_SSL_ROOT_CERT: '/certs/root.pem',
  FIT_TENANT_TRAINER_ID: TRAINER_ID,
  SUPABASE_DB_PASSWORD: 'password with symbols #:/',
  SUPABASE_PROJECT_ID: PROJECT_ID,
}
const BUNDLE: TenantMigrationBundle = {
  format: 'fit-tenant-bundle-v1',
  createdAt: '2026-09-04T10:00:00.000Z',
  tenantFingerprint: 'a'.repeat(16),
  trainerId: TRAINER_ID,
  tables: [
    {
      name: 'public.profiles',
      rowCount: 2,
      checksum: 'b'.repeat(64),
      rows: [],
    },
  ],
}

function trainerIdOf(bundle: TenantMigrationBundle): string {
  if (bundle.format !== 'fit-tenant-bundle-v1') {
    throw new Error('trainer bundle expected')
  }
  return bundle.trainerId
}

describe('remote tenant rehearsal configuration', () => {
  it('builds only the linked Supabase session pooler connection', () => {
    const config = buildSupabaseSourceConfig(
      SOURCE_ENVIRONMENT,
      () => 'trusted-ca',
    )

    const parsed = new URL(String(config.connectionString))
    expect(parsed.hostname).toBe('aws-0-eu-west-1.pooler.supabase.com')
    expect(parsed.username).toBe(`postgres.${PROJECT_ID}`)
    expect(decodeURIComponent(parsed.password)).toBe('password with symbols #:/')
    expect(config.ssl).toEqual({ ca: 'trusted-ca', rejectUnauthorized: true })
  })

  it.each([
    'postgresql://postgres.abcdefghijklmnopqrst@db.example.com:5432/postgres',
    'postgresql://postgres.abcdefghijklmnopqrst:already-set@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres.otherprojectxxxxxx@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
  ])('rejects an unexpected source URL: %s', (sourceUrl) => {
    expect(() => buildSupabaseSourceConfig(
      { ...SOURCE_ENVIRONMENT, FIT_TENANT_SOURCE_POOLER_URL: sourceUrl },
      () => 'trusted-ca',
    )).toThrowError(RemoteTenantRehearsalError)
  })

  it('reports an unreadable source certificate without leaking its path', () => {
    expect(() => buildSupabaseSourceConfig(
      SOURCE_ENVIRONMENT,
      () => { throw new Error('/private/certificate/path') },
    )).toThrowError(
      new RemoteTenantRehearsalError('source_certificate_unreadable'),
    )
  })

  it('keeps audit source-only and validates stage settings for dry-run', () => {
    const audit = readRemoteTenantRehearsalSettings(
      SOURCE_ENVIRONMENT,
      () => 'trusted-ca',
    )
    expect(audit.mode).toBe('audit')
    expect(audit.stageContainerUrl).toBeUndefined()
    expect(audit.tenantSelection).toEqual({
      kind: 'configured',
      trainerId: TRAINER_ID,
    })

    const dryRun = readRemoteTenantRehearsalSettings(
      {
        ...SOURCE_ENVIRONMENT,
        FIT_TENANT_REHEARSAL_MODE: 'dry-run',
        FIT_TENANT_STAGE_CONTAINER_URL:
          'https://bba123stage.containers.yandexcloud.net',
        YC_TOKEN: 'ephemeral-iam-token',
      },
      () => 'trusted-ca',
    )
    expect(dryRun.stageContainerUrl).toBe(
      'https://bba123stage.containers.yandexcloud.net',
    )
  })

  it('requires an exact independent apply confirmation', () => {
    expect(() => readRemoteTenantRehearsalSettings(
      {
        ...SOURCE_ENVIRONMENT,
        FIT_TENANT_REHEARSAL_MODE: 'apply',
        FIT_TENANT_STAGE_CONTAINER_URL:
          'https://bba123stage.containers.yandexcloud.net',
        YC_TOKEN: 'ephemeral-iam-token',
      },
      () => 'trusted-ca',
    )).toThrowError(new RemoteTenantRehearsalError('apply_not_confirmed'))
  })

  it('requires a rehearsed fingerprint for automatic apply selection', () => {
    const audit = readRemoteTenantRehearsalSettings(
      {
        ...SOURCE_ENVIRONMENT,
        FIT_TENANT_SELECTION_MODE: 'smallest-eligible',
        FIT_TENANT_TRAINER_ID: undefined,
      },
      () => 'trusted-ca',
    )
    expect(audit.tenantSelection).toEqual({ kind: 'smallest-eligible' })

    expect(() => readRemoteTenantRehearsalSettings(
      {
        ...SOURCE_ENVIRONMENT,
        FIT_TENANT_REHEARSAL_MODE: 'apply',
        FIT_TENANT_REMOTE_APPLY_CONFIRMATION:
          'APPLY_TENANT_TO_YANDEX_STAGE',
        FIT_TENANT_SELECTION_MODE: 'smallest-eligible',
        FIT_TENANT_TRAINER_ID: undefined,
      },
      () => 'trusted-ca',
    )).toThrowError(new RemoteTenantRehearsalError(
      'tenant_fingerprint_required',
    ))

    const apply = readRemoteTenantRehearsalSettings(
      {
        ...SOURCE_ENVIRONMENT,
        FIT_TENANT_REHEARSAL_MODE: 'apply',
        FIT_TENANT_REMOTE_APPLY_CONFIRMATION:
          'APPLY_TENANT_TO_YANDEX_STAGE',
        FIT_TENANT_SELECTION_MODE: 'smallest-eligible',
        FIT_TENANT_EXPECTED_FINGERPRINT: 'a'.repeat(16),
        FIT_TENANT_STAGE_CONTAINER_URL:
          'https://bba123stage.containers.yandexcloud.net',
        FIT_TENANT_TRAINER_ID: undefined,
        YC_TOKEN: 'ephemeral-iam-token',
      },
      () => 'trusted-ca',
    )
    expect(apply.tenantSelection).toEqual({ kind: 'smallest-eligible' })
    expect(apply.expectedTenantFingerprint).toBe('a'.repeat(16))

    const standalone = readRemoteTenantRehearsalSettings(
      {
        ...SOURCE_ENVIRONMENT,
        FIT_TENANT_SELECTION_MODE: 'smallest-eligible-standalone-client',
        FIT_TENANT_TRAINER_ID: undefined,
      },
      () => 'trusted-ca',
    )
    expect(standalone.tenantSelection).toEqual({
      kind: 'smallest-eligible-standalone-client',
    })
  })

  it('rejects a malformed or changed tenant fingerprint', () => {
    expect(() => readRemoteTenantRehearsalSettings(
      {
        ...SOURCE_ENVIRONMENT,
        FIT_TENANT_EXPECTED_FINGERPRINT: 'not-a-fingerprint',
      },
      () => 'trusted-ca',
    )).toThrowError(new RemoteTenantRehearsalError(
      'tenant_fingerprint_invalid',
    ))

    expect(() => requireExpectedTenantFingerprint(
      BUNDLE,
      'c'.repeat(16),
    )).toThrowError(new RemoteTenantRehearsalError(
      'tenant_fingerprint_mismatch',
    ))
    expect(() => requireExpectedTenantFingerprint(
      BUNDLE,
      BUNDLE.tenantFingerprint,
    )).not.toThrow()
  })
})

describe('automatic source tenant selection', () => {
  it('skips unsafe cohorts and exports the smallest eligible tenant', async () => {
    let preflight = 0
    const query = vi.fn((sql: string) => {
      if (sql.includes('order by count(*) asc')) {
        return Promise.resolve([
          { trainer_id: TRAINER_ID },
          { trainer_id: SECOND_TRAINER_ID },
        ])
      }
      if (sql.includes('as trainer_exists')) {
        preflight += 1
        return Promise.resolve([{
          trainer_exists: true,
          client_count: 1,
          has_shared_membership: preflight === 1,
          has_missing_root_membership: false,
          has_foreign_relationship: false,
          has_cross_boundary_merge: false,
          has_pending_push: false,
          has_foreign_actor: false,
        }])
      }
      return Promise.resolve([])
    }) as unknown as DatabaseClient['query']

    const bundle = await exportSelectedTenant(
      { query },
      { kind: 'smallest-eligible' },
      new Date('2026-09-07T12:00:00.000Z'),
    )

    expect(trainerIdOf(bundle)).toBe(SECOND_TRAINER_ID)
    expect(bundle.createdAt).toBe('2026-09-07T12:00:00.000Z')
    expect(preflight).toBe(2)
  })

  it('does not hide an export contract failure', async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes('order by count(*) asc')) {
        return Promise.resolve([{ trainer_id: TRAINER_ID }])
      }
      if (sql.includes('as trainer_exists')) {
        return Promise.resolve([{
          trainer_exists: true,
          client_count: 1,
          has_shared_membership: false,
          has_missing_root_membership: false,
          has_foreign_relationship: false,
          has_cross_boundary_merge: false,
          has_pending_push: false,
          has_foreign_actor: false,
        }])
      }
      if (sql.includes('from public.profiles')) {
        return Promise.reject(new Error('schema drift'))
      }
      return Promise.resolve([])
    }) as unknown as DatabaseClient['query']

    await expect(exportSelectedTenant(
      { query },
      { kind: 'smallest-eligible' },
    )).rejects.toEqual(
      new TenantMigrationError('source_read_failed:public.profiles'),
    )
  })

  it('skips an eligible tenant rejected by stage and tries the next one', async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes('order by count(*) asc')) {
        return Promise.resolve([
          { trainer_id: TRAINER_ID },
          { trainer_id: SECOND_TRAINER_ID },
        ])
      }
      if (sql.includes('as trainer_exists')) {
        return Promise.resolve([{
          trainer_exists: true,
          client_count: 1,
          has_shared_membership: false,
          has_missing_root_membership: false,
          has_foreign_relationship: false,
          has_cross_boundary_merge: false,
          has_pending_push: false,
          has_foreign_actor: false,
        }])
      }
      return Promise.resolve([])
    }) as unknown as DatabaseClient['query']
    const acceptCandidate = vi.fn((bundle: TenantMigrationBundle) =>
      Promise.resolve(trainerIdOf(bundle) === SECOND_TRAINER_ID))

    const bundle = await exportSelectedTenant(
      { query },
      { kind: 'smallest-eligible' },
      new Date('2026-09-07T12:00:00.000Z'),
      acceptCandidate,
    )

    expect(trainerIdOf(bundle)).toBe(SECOND_TRAINER_ID)
    expect(acceptCandidate.mock.calls.map(([candidate]) => trainerIdOf(candidate)))
      .toEqual([TRAINER_ID, SECOND_TRAINER_ID])
  })

  it('reports when every eligible tenant already conflicts in stage', async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes('order by count(*) asc')) {
        return Promise.resolve([{ trainer_id: TRAINER_ID }])
      }
      if (sql.includes('as trainer_exists')) {
        return Promise.resolve([{
          trainer_exists: true,
          client_count: 1,
          has_shared_membership: false,
          has_missing_root_membership: false,
          has_foreign_relationship: false,
          has_cross_boundary_merge: false,
          has_pending_push: false,
          has_foreign_actor: false,
        }])
      }
      return Promise.resolve([])
    }) as unknown as DatabaseClient['query']

    await expect(exportSelectedTenant(
      { query },
      { kind: 'smallest-eligible' },
      new Date('2026-09-07T12:00:00.000Z'),
      () => Promise.resolve(false),
    )).rejects.toEqual(
      new RemoteTenantRehearsalError('stage_candidate_not_found'),
    )
  })

  it('selects an unlinked standalone client without requiring a trainer secret', async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes('as client_profile_exists')) {
        return Promise.resolve([{
          client_profile_exists: true,
          owned_client_count: 1,
          has_non_standalone_root: false,
          has_membership: false,
          has_active_relationship: false,
          has_cross_boundary_merge: false,
          has_pending_push: false,
          has_chat_media: false,
        }])
      }
      if (sql.includes("profile.account_role = 'client'")) {
        return Promise.resolve([{ profile_id: CLIENT_PROFILE_ID }])
      }
      return Promise.resolve([])
    }) as unknown as DatabaseClient['query']

    const bundle = await exportSelectedTenant(
      { query },
      { kind: 'smallest-eligible-standalone-client' },
      new Date('2026-09-11T12:00:00.000Z'),
    )

    expect(bundle).toMatchObject({
      format: 'fit-standalone-client-bundle-v1',
      clientProfileId: CLIENT_PROFILE_ID,
      createdAt: '2026-09-11T12:00:00.000Z',
    })
  })
})

describe('automatic stage candidate selection', () => {
  const profileConflict = new RemoteTenantRehearsalError(
    'stage_request_failed:409:target_validation_failed:public.profiles',
  )

  it('skips only checksum conflicts caused by an existing target tenant', () => {
    expect(isStageTenantConflict(profileConflict)).toBe(true)
    expect(readStageTenantConflictCode(profileConflict))
      .toBe('target_validation_failed:public.profiles')
    expect(isStageTenantConflict(new RemoteTenantRehearsalError(
      'stage_request_failed:409:target_import_failed:public.profiles',
    ))).toBe(false)
    expect(isStageTenantConflict(new RemoteTenantRehearsalError(
      'stage_request_failed:503',
    ))).toBe(false)
  })

  it('reports every safe stage conflict reason without tenant identifiers', () => {
    expect(formatStageConflictDiagnostics(new Map([
      ['target_validation_failed:public.workouts', 2],
      ['target_validation_failed:public.profiles', 3],
    ]))).toEqual([
      'selection: skipped_stage_conflicts=5; distinct_stage_conflict_reasons=2',
      'selection_conflict: reason=target_validation_failed:public.profiles; count=3',
      'selection_conflict: reason=target_validation_failed:public.workouts; count=2',
    ])
  })
})

describe('source database failure reporting', () => {
  it('reports a PostgreSQL SQLSTATE without exposing the error message', () => {
    expect(readSourceDatabaseFailureCode({
      code: '42P01',
      message: 'relation secret_table does not exist',
    })).toBe('source_database_failed:sqlstate_42P01')
  })

  it('reports only explicitly allowed transport error codes', () => {
    expect(readSourceDatabaseFailureCode({ code: 'ETIMEDOUT' }))
      .toBe('source_database_failed:transport_ETIMEDOUT')
  })

  it('keeps unknown errors generic', () => {
    const code = readSourceDatabaseFailureCode({
      code: 'PRIVATE_DATABASE_HOST',
      message: 'password=do-not-print',
    })

    expect(code).toBe('source_database_failed')
    expect(code).not.toContain('do-not-print')
  })

})

describe('stage tenant migration response', () => {
  const response = {
    status: 'tenant_migration_dry_run',
    tenantFingerprint: BUNDLE.tenantFingerprint,
    tables: [{ name: 'public.profiles', rows: 2, inserted: 2 }],
  }

  it('accepts the exact aggregate-only response', () => {
    expect(readStageTenantMigrationResponse(
      response,
      'tenant_migration_dry_run',
      BUNDLE,
    )).toEqual(response)
  })

  it.each([
    { ...response, tenantFingerprint: 'c'.repeat(16) },
    {
      ...response,
      tables: [{ name: 'public.profiles', rows: 3, inserted: 2 }],
    },
    { ...response, extra: 'unexpected' },
  ])('rejects a mismatched or expanded response', (candidate) => {
    expect(() => readStageTenantMigrationResponse(
      candidate,
      'tenant_migration_dry_run',
      BUNDLE,
    )).toThrowError(RemoteTenantRehearsalError)
  })

  it('requires the repeated apply to insert zero rows', () => {
    expect(() => readStageTenantMigrationResponse(
      {
        ...response,
        status: 'tenant_migration_applied',
        tables: [{ name: 'public.profiles', rows: 2, inserted: 1 }],
      },
      'tenant_migration_applied',
      BUNDLE,
      true,
    )).toThrowError(new RemoteTenantRehearsalError('stage_response_mismatch'))
  })
})

describe('stage tenant migration rejection reporting', () => {
  it('accepts only the narrow aggregate rejection contract', () => {
    expect(readStageTenantMigrationRejectionCode(JSON.stringify({
      status: 'tenant_migration_rejected',
      code: 'target_import_failed:public.clients',
    }))).toBe('target_import_failed:public.clients')
  })

  it.each([
    'not-json',
    JSON.stringify({
      status: 'tenant_migration_rejected',
      code: 'target_import_failed:public.clients',
      detail: 'private row contents',
    }),
    JSON.stringify({
      status: 'tenant_migration_rejected',
      code: 'target failed with private detail',
    }),
    JSON.stringify({ status: 'tenant_migration_failed' }),
  ])('does not forward an expanded or unsafe response: %s', (responseBody) => {
    expect(readStageTenantMigrationRejectionCode(responseBody)).toBeUndefined()
  })
})
