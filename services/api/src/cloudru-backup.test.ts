import { describe, expect, it } from 'vitest'
import { decryptCloudruBackup, encryptCloudruBackup } from './cloudru-backup.js'
import { S3ServiceException } from '@aws-sdk/client-s3'
import { cloudruStorageFailure } from './cloudru-storage-error.js'

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
