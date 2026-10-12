import { describe, expect, it } from 'vitest'

import {
  CloudDatabaseTransferError,
  decryptDatabaseDump,
  encryptDatabaseDump,
  readDatabaseTransferConnection,
} from './cloud-database-transfer.js'

describe('cloud database transfer encryption', () => {
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
      sslRootCert: '/app/certs/yandex-cloud-ca.pem',
      user: 'fit_owner',
    })
  })
})
