import { describe, expect, it } from 'vitest'

import {
  CloudDatabaseTransferError,
  classifyPgDumpFailure,
  decryptDatabaseDump,
  encryptDatabaseDump,
  readDatabaseTransferConnection,
  safePgDumpDiagnostic,
} from './cloud-database-transfer.js'

describe('cloud database transfer encryption', () => {
  it('classifies pg_dump failures without returning raw database error details', () => {
    expect(classifyPgDumpFailure('ERROR: permission denied for table private_table'))
      .toBe('database_export_source_permission_denied')
    expect(classifyPgDumpFailure('SSL error: certificate verify failed'))
      .toBe('database_export_source_tls_failed')
    expect(classifyPgDumpFailure('could not connect to server'))
      .toBe('database_export_source_connection_failed')
    expect(classifyPgDumpFailure('unclassified failure'))
      .toBe('database_export_source_dump_failed')
  })

  it('limits a private pg_dump diagnostic to error lines and redacts credentials', () => {
    expect(safePgDumpDiagnostic(
      'pg_dump: error: connection failed password=private123\npg_dump: detail: Query was: select personal_data\n',
      'private123',
    )).toBe('pg_dump: error: connection failed password=[REDACTED]')
    expect(safePgDumpDiagnostic('unrecognized process output', 'private123')).toBeUndefined()
  })

  it('round-trips without exposing plaintext in the envelope', async () => {
    const plaintext = Buffer.from('private database row')
    const encrypted = await encryptDatabaseDump(plaintext, 'p'.repeat(32))
    expect(encrypted.includes(plaintext)).toBe(false)
    expect(await decryptDatabaseDump(encrypted, 'p'.repeat(32))).toEqual(plaintext)
  })

  it('rejects a wrong passphrase without returning partial plaintext', async () => {
    const encrypted = await encryptDatabaseDump(
      Buffer.from('private database row'),
      'p'.repeat(32),
    )
    await expect(decryptDatabaseDump(encrypted, 'q'.repeat(32)))
      .rejects.toMatchObject({ code: 'database_export_decryption_failed' })
  })

  it('requires the complete verified TLS connection contract', () => {
    expect(() => readDatabaseTransferConnection({}, 'MIGRATION_DATABASE'))
      .toThrow(CloudDatabaseTransferError)
    expect(readDatabaseTransferConnection({
      MIGRATION_DATABASE_HOST: 'source.internal',
      MIGRATION_DATABASE_PORT: '6432',
      MIGRATION_DATABASE_NAME: 'fit',
      MIGRATION_DATABASE_USER: 'fit_owner',
      MIGRATION_DATABASE_PASSWORD: 'secret',
      MIGRATION_DATABASE_SSL_ROOT_CERT: '/app/certs/yandex-cloud-ca.pem',
    }, 'MIGRATION_DATABASE')).toEqual({
      database: 'fit',
      host: 'source.internal',
      password: 'secret',
      port: '6432',
      sslMode: 'verify-full',
      sslRootCert: '/app/certs/yandex-cloud-ca.pem',
      user: 'fit_owner',
    })
  })

  it('allows encrypted TLS only for the Cloud.ru migration target', () => {
    const environment = {
      MIGRATION_DATABASE_HOST: '10.70.10.67',
      MIGRATION_DATABASE_PORT: '5432',
      MIGRATION_DATABASE_NAME: 'fit',
      MIGRATION_DATABASE_USER: 'fit_owner',
      MIGRATION_DATABASE_PASSWORD: 'secret',
      MIGRATION_DATABASE_SSL_MODE: 'require',
    }
    expect(readDatabaseTransferConnection(environment, 'MIGRATION_DATABASE'))
      .toMatchObject({ host: '10.70.10.67', sslMode: 'require' })
    expect(() => readDatabaseTransferConnection({
      ...environment,
      MIGRATION_DATABASE_HOST: 'source.internal',
    }, 'MIGRATION_DATABASE')).toThrow(CloudDatabaseTransferError)
  })
})
