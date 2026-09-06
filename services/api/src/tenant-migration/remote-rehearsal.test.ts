import { describe, expect, it } from 'vitest'

import {
  buildSupabaseSourceConfig,
  readRemoteTenantRehearsalFailureCode,
  readSourceDatabaseFailureCode,
  readRemoteTenantRehearsalSettings,
  readStageTenantMigrationResponse,
  RemoteTenantRehearsalError,
} from './remote-rehearsal.js'
import type { TenantMigrationBundle } from './types.js'

const TRAINER_ID = '10000000-0000-4000-8000-000000000001'
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

  it('keeps audit source-only and validates stage settings for dry-run', () => {
    const audit = readRemoteTenantRehearsalSettings(
      SOURCE_ENVIRONMENT,
      () => 'trusted-ca',
    )
    expect(audit.mode).toBe('audit')
    expect(audit.stageContainerUrl).toBeUndefined()

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

  it('reads reviewed failure classes structurally without leaking unknowns', () => {
    expect(readRemoteTenantRehearsalFailureCode({
      code: 'source_read_failed:public.workouts',
      name: 'TenantMigrationError',
    })).toBe('source_read_failed:public.workouts')
    expect(readRemoteTenantRehearsalFailureCode(new TypeError('private value')))
      .toBe('unexpected_failure:TypeError')
    expect(readRemoteTenantRehearsalFailureCode({
      code: 'private value',
      name: 'UnknownError',
    })).toBe('unexpected_failure')
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
