import { readFile, readdir } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { assertTransactionalUpSql, cloudruMigrationConfig, migrationFailureReason } from './cloudru-release-migrations.js'

const confirmed = {
  CLOUDRU_MIGRATION_CONFIRMATION: 'APPLY_CLOUDRU_PENDING_MIGRATIONS',
  RELEASE_SHA: 'a'.repeat(40),
  MIGRATION_DATABASE_HOST: '10.70.10.67',
  MIGRATION_DATABASE_PORT: '5432',
  MIGRATION_DATABASE_NAME: 'fit',
  MIGRATION_DATABASE_USER: 'fit_owner',
  MIGRATION_DATABASE_PASSWORD: 'synthetic-owner-password',
  MIGRATION_DATABASE_SSL_MODE: 'require',
}

describe('Cloud.ru release migration connection', () => {
  it('uses only the confirmed owner and existing approved TLS contract', () => {
    expect(cloudruMigrationConfig({ ...confirmed, DATABASE_USER: 'fit_api', DATABASE_PASSWORD: 'synthetic-runtime-password' }))
      .toMatchObject({ host: '10.70.10.67', port: 5432, database: 'fit', user: 'fit_owner',
        password: 'synthetic-owner-password', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 })
  })

  it.each([
    { CLOUDRU_MIGRATION_CONFIRMATION: '' }, { RELEASE_SHA: '../main' },
    { MIGRATION_DATABASE_HOST: 'production.example' }, { MIGRATION_DATABASE_PORT: '5433' },
    { MIGRATION_DATABASE_NAME: 'other' }, { MIGRATION_DATABASE_USER: 'fit_api' },
    { MIGRATION_DATABASE_SSL_MODE: 'disable' }, { MIGRATION_DATABASE_URL: 'postgres://synthetic.invalid/db' },
  ])('rejects a different target, runtime role or unconfirmed run: %j', change => {
    expect(() => cloudruMigrationConfig({ ...confirmed, ...change })).toThrow('cloudru_migration_target_rejected')
  })

  it('fails without an owner credential, instead of borrowing the runtime password', () => {
    expect(() => cloudruMigrationConfig({ ...confirmed, MIGRATION_DATABASE_PASSWORD: '' }))
      .toThrow('cloudru_migration_config_missing')
  })

  it('redacts driver messages, SQL, credentials and stack traces', () => {
    const reason = migrationFailureReason(new Error('synthetic-password SELECT private_fixture FROM profiles'))
    expect(reason).toBe('cloudru_migration_failed')
  })

  it.each(['BEGIN;', 'COMMIT;', 'END;', 'ROLLBACK;', 'START TRANSACTION;', 'ABORT;', "PREPARE TRANSACTION 'fixture';"])('rejects top-level transaction control: %s', sql => {
    expect(() => assertTransactionalUpSql(`-- Up Migration\nselect 1; ${sql}\n-- Down Migration\nselect 1;`))
      .toThrow('cloudru_migration_transaction_rejected')
  })

  it('allows normal DO/functions, quoted literals and comments and ignores Down SQL', () => {
    expect(() => assertTransactionalUpSql(`-- Up Migration
      DO $body$ BEGIN PERFORM 1; END; $body$;
      select 'COMMIT;', 'it''s not a transaction', "END";
      /* COMMIT; */ -- BEGIN;
      select 1;
      -- Down Migration
      COMMIT;`)).not.toThrow()
  })

  it('handles nested comments and standard versus E-string escaping without hiding a transaction', () => {
    expect(() => assertTransactionalUpSql("/* outer /* nested */ 'quoted; COMMIT;' */ select E'escaped\\'quote';"))
      .not.toThrow()
    expect(() => assertTransactionalUpSql("select 'literal\\'; COMMIT;"))
      .toThrow('cloudru_migration_transaction_rejected')
    expect(() => assertTransactionalUpSql("/* outer /* nested */ 'quoted */ COMMIT; select 'text';"))
      .toThrow('cloudru_migration_transaction_rejected')
  })

  it('accepts the existing reviewed SQL chain, including ordinary PL/pgSQL blocks', async () => {
    const directory = new URL('../db/migrations/', import.meta.url)
    for (const file of await readdir(directory)) {
      assertTransactionalUpSql(await readFile(new URL(file, directory), 'utf8'))
    }
  })
})
