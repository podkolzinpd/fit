import { describe, expect, it } from 'vitest'

import {
  buildMigrationTable,
  canonicalJson,
  decryptMigrationBundle,
  encryptMigrationBundle,
  fingerprintTenant,
  readMigrationBundle,
  TenantMigrationArtifactError,
} from './bundle.js'
import type { TenantMigrationBundle } from './types.js'

const TRAINER_ID = '11111111-1111-4111-8111-111111111111'
const PASSPHRASE = 'local-test-passphrase-with-32-characters'

function buildBundle(): TenantMigrationBundle {
  return {
    format: 'fit-tenant-bundle-v1',
    createdAt: '2026-09-01T10:00:00.000Z',
    tenantFingerprint: fingerprintTenant(TRAINER_ID),
    trainerId: TRAINER_ID,
    tables: [
      buildMigrationTable('public.profiles', [
        { id: TRAINER_ID, timezone: 'Europe/Moscow' },
      ]),
    ],
  }
}

describe('tenant migration bundle', () => {
  it('canonicalizes object keys and table row order', () => {
    expect(canonicalJson({ z: 1, a: { y: true, x: null } })).toBe(
      '{"a":{"x":null,"y":true},"z":1}',
    )
    const left = buildMigrationTable('public.clients', [
      { id: 'b', version: 1 },
      { version: 2, id: 'a' },
    ])
    const right = buildMigrationTable('public.clients', [
      { id: 'a', version: 2 },
      { version: 1, id: 'b' },
    ])
    expect(left.checksum).toBe(right.checksum)
    expect(left.rows).toEqual(right.rows)
  })

  it('encrypts and decrypts without exposing plaintext in the envelope', async () => {
    const bundle = buildBundle()
    const envelope = await encryptMigrationBundle(bundle, PASSPHRASE)
    expect(JSON.stringify(envelope)).not.toContain(TRAINER_ID)
    await expect(decryptMigrationBundle(envelope, PASSPHRASE)).resolves.toEqual(bundle)
  })

  it('rejects a wrong passphrase and tampered table checksum', async () => {
    const bundle = buildBundle()
    const envelope = await encryptMigrationBundle(bundle, PASSPHRASE)
    await expect(
      decryptMigrationBundle(envelope, 'another-long-local-passphrase'),
    ).rejects.toMatchObject({ code: 'artifact_decryption_failed' })

    const tampered = structuredClone(bundle)
    tampered.tables[0]!.rows[0] = { id: 'changed' }
    expect(() => readMigrationBundle(tampered)).toThrowError(
      TenantMigrationArtifactError,
    )
  })

  it('rejects a short passphrase and mismatched tenant fingerprint', async () => {
    await expect(encryptMigrationBundle(buildBundle(), 'too-short')).rejects
      .toMatchObject({ code: 'passphrase_too_short' })
    const bundle = buildBundle()
    bundle.tenantFingerprint = '0000000000000000'
    expect(() => readMigrationBundle(bundle)).toThrowError(
      TenantMigrationArtifactError,
    )
  })
})
