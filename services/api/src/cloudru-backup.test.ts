import { describe, expect, it } from 'vitest'
import { decryptCloudruBackup, encryptCloudruBackup } from './cloudru-backup.js'

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
