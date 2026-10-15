import { describe, expect, it } from 'vitest'
import { assertPrivateBackupAcl, cloudruBackupStorageCredentials, decryptCloudruBackup, encryptCloudruBackup, privateBackupAccessPolicy } from './cloudru-backup.js'
import { S3ServiceException } from '@aws-sdk/client-s3'
import { cloudruStorageFailure } from './cloudru-storage-error.js'

describe('Cloud.ru backup credential boundary', () => {
  const media = { CLOUDRU_TENANT_ID: 'f071c7d5-cf0f-4538-9415-bbf9a9c94338',
    CLOUDRU_MEDIA_KEY_ID: 'synthetic-runtime-key', CLOUDRU_MEDIA_KEY_SECRET: 'synthetic-runtime-secret' }
  const dedicated = { ...media, CLOUDRU_BACKUP_KEY_ID: 'synthetic-backup-key', CLOUDRU_BACKUP_KEY_SECRET: 'synthetic-backup-secret' }

  it('uses only the dedicated backup pair even when runtime media credentials are present', () => {
    expect(cloudruBackupStorageCredentials(dedicated)).toEqual({
      accessKeyId: `${media.CLOUDRU_TENANT_ID}:synthetic-backup-key`, secretAccessKey: 'synthetic-backup-secret',
    })
  })

  it('never borrows runtime media credentials for a missing or incomplete backup pair', () => {
    for (const environment of [media, { ...dedicated, CLOUDRU_BACKUP_KEY_ID: '' }, { ...dedicated, CLOUDRU_BACKUP_KEY_SECRET: '' }]) {
      expect(() => cloudruBackupStorageCredentials(environment)).toThrow('backup_configuration_rejected')
    }
  })

  it.each([{ CLOUDRU_TENANT_ID: 'other-tenant' }, { CLOUDRU_BACKUP_KEY_SECRET: 'synthetic\nsecret' }])(
    'rejects a different tenant or an invalid credential without leaking it', change => {
      expect(() => cloudruBackupStorageCredentials({ ...dedicated, ...change })).toThrow('backup_configuration_rejected')
    },
  )
})

describe('Cloud.ru private backup principals', () => {
  const owner = { Owner: { ID: 'synthetic-owner' }, Grants: [
    { Grantee: { Type: 'CanonicalUser' as const, ID: 'synthetic-owner' }, Permission: 'FULL_CONTROL' as const },
  ] }
  const backup = { Type: 'CanonicalUser' as const, ID: 'synthetic-backup-account' }

  it('accepts owner-only defaults and the explicitly approved backup account with data/ACL-read grants', () => {
    expect(() => assertPrivateBackupAcl(owner, backup.ID)).not.toThrow()
    expect(() => assertPrivateBackupAcl({ ...owner, Grants: [...owner.Grants,
      { Grantee: backup, Permission: 'READ' }, { Grantee: backup, Permission: 'WRITE' },
      { Grantee: backup, Permission: 'READ_ACP' },
    ] }, backup.ID)).not.toThrow()
    const policy = privateBackupAccessPolicy(owner, backup.ID)
    expect(policy).toEqual({ Owner: owner.Owner, Grants: [...owner.Grants,
      { Grantee: backup, Permission: 'READ' }, { Grantee: backup, Permission: 'WRITE' },
      { Grantee: backup, Permission: 'READ_ACP' },
    ] })
    expect(privateBackupAccessPolicy(owner, owner.Owner.ID)).toEqual(owner)
  })

  it.each([
    { Type: 'Group' as const, URI: 'http://acs.amazonaws.com/groups/global/AllUsers' },
    { Type: 'CanonicalUser' as const, ID: 'unapproved-account' },
  ])('rejects public groups and other private accounts: %j', grantee => {
    expect(() => privateBackupAccessPolicy({ ...owner, Grants: [...owner.Grants,
      { Grantee: grantee, Permission: 'READ' },
    ] }, backup.ID)).toThrow('backup_bucket_not_private')
  })

  it('rejects permissions that let the backup writer change bucket access', () => {
    for (const permission of ['FULL_CONTROL', 'WRITE_ACP'] as const) {
      expect(() => privateBackupAccessPolicy({ ...owner, Grants: [...owner.Grants,
        { Grantee: backup, Permission: permission },
      ] }, backup.ID)).toThrow('backup_bucket_not_private')
    }
  })
})

it('reports only reviewed storage codes and HTTP status, never error payloads or private paths', () => {
  const error = new S3ServiceException({ name: 'AccessDenied', $fault: 'client',
    $metadata: { httpStatusCode: 403, requestId: 'private-request' }, message: 'private object or credential' })
  expect(cloudruStorageFailure(error)).toEqual({ reason: 'AccessDenied', httpStatus: 403 })
  error.name = 'private-object-name'
  expect(cloudruStorageFailure(error)).toEqual({ reason: 'storage_operation_failed', httpStatus: 403 })
  expect(cloudruStorageFailure(new Error('private-secret'))).toEqual({ reason: 'storage_operation_failed' })
  expect(cloudruStorageFailure(new Error('backup_bucket_not_private'))).toEqual({ reason: 'backup_bucket_not_private' })
})

describe('Cloud.ru offsite backup encryption', () => {
  const key = 'a'.repeat(64)
  const plain = Buffer.from('synthetic PostgreSQL backup fixture')
  it('roundtrips exact bytes with authenticated encryption and a fresh nonce for every backup', () => {
    const first = encryptCloudruBackup(plain, key)
    const second = encryptCloudruBackup(plain, key)
    expect(first.equals(second)).toBe(false)
    expect(first.includes(plain)).toBe(false)
    expect(decryptCloudruBackup(first, key)).toEqual(plain)
  })
  it('rejects a wrong key, modified payload, modified authentication tag or truncated envelope', () => {
    const encrypted = encryptCloudruBackup(plain, key)
    expect(() => decryptCloudruBackup(encrypted, 'b'.repeat(64))).toThrow()
    for (const index of [0, 8, 20, encrypted.length - 1]) {
      const changed = Buffer.from(encrypted)
      changed[index] = (changed[index] ?? 0) ^ 1
      expect(() => decryptCloudruBackup(changed, key)).toThrow()
    }
    expect(() => decryptCloudruBackup(encrypted.subarray(0, 25), key)).toThrow()
    expect(() => encryptCloudruBackup(plain, '')).toThrow('backup_encryption_key_rejected')
  })
})
