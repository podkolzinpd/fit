import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'
import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import {
  buildMigrationTable,
  canonicalJson,
  decryptMigrationBundle,
  encryptMigrationBundle,
  fingerprintFullCohort,
  fingerprintStandaloneClient,
  fingerprintTenant,
  getTenantMigrationRoot,
  readJsonObject,
  readMigrationBundle,
  TenantMigrationArtifactError,
} from './bundle.js'
import type {
  TenantMigrationBundle,
  TenantMigrationEnvelope,
} from './types.js'

const TRAINER_ID = '11111111-1111-4111-8111-111111111111'
const CLIENT_PROFILE_ID = '22222222-2222-4222-8222-222222222222'
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

function buildStandaloneBundle(): TenantMigrationBundle {
  return {
    format: 'fit-standalone-client-bundle-v1',
    createdAt: '2026-09-01T10:00:00.000Z',
    tenantFingerprint: fingerprintStandaloneClient(CLIENT_PROFILE_ID),
    clientProfileId: CLIENT_PROFILE_ID,
    tables: [
      buildMigrationTable('public.profiles', [
        { id: CLIENT_PROFILE_ID, timezone: 'Europe/Moscow' },
      ]),
    ],
  }
}

function buildFullCohortBundle(): TenantMigrationBundle {
  const tables = [
    buildMigrationTable('public.profiles', [
      { id: TRAINER_ID, timezone: 'Europe/Moscow' },
    ]),
  ]
  return {
    format: 'fit-full-cohort-bundle-v1',
    createdAt: '2026-09-01T10:00:00.000Z',
    tenantFingerprint: fingerprintFullCohort(tables),
    tables,
  }
}

function encryptLegacyGzipEnvelope(
  bundle: TenantMigrationBundle,
): TenantMigrationEnvelope {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(PASSPHRASE, salt, 32, {
    N: 32_768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(gzipSync(canonicalJson(readJsonObject(bundle)), { level: 9 })),
    cipher.final(),
  ])
  return {
    format: 'fit-tenant-envelope-v2',
    compression: { name: 'gzip' },
    kdf: { name: 'scrypt', salt: salt.toString('base64') },
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    },
    ciphertext: ciphertext.toString('base64'),
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
    expect(envelope).toMatchObject({
      format: 'fit-tenant-envelope-v3',
      compression: { name: 'brotli' },
    })
    expect(JSON.stringify(envelope)).not.toContain(TRAINER_ID)
    await expect(decryptMigrationBundle(envelope, PASSPHRASE)).resolves.toEqual(bundle)
  })

  it('compresses repetitive cohort data densely before encryption', async () => {
    const bundle = buildBundle()
    bundle.tables[0] = buildMigrationTable(
      'public.profiles',
      Array.from({ length: 10_000 }, (_, index) => ({
        id: `profile-${index}`,
        repeatedValue: 'same value repeated in every exported row',
      })),
    )

    const plaintextBytes = Buffer.byteLength(JSON.stringify(bundle))
    const envelope = await encryptMigrationBundle(bundle, PASSPHRASE)
    const encryptedBytes = Buffer.byteLength(JSON.stringify(envelope))

    expect(encryptedBytes).toBeLessThan(plaintextBytes / 4)
    await expect(decryptMigrationBundle(envelope, PASSPHRASE)).resolves.toEqual(bundle)
  })

  it('keeps accepting gzip-compressed v2 envelopes', async () => {
    const bundle = buildBundle()
    await expect(
      decryptMigrationBundle(encryptLegacyGzipEnvelope(bundle), PASSPHRASE),
    ).resolves.toEqual(bundle)
  })

  it('keeps standalone client artifacts distinct from trainer tenants', async () => {
    const bundle = buildStandaloneBundle()
    expect(bundle.tenantFingerprint).not.toBe(fingerprintTenant(CLIENT_PROFILE_ID))
    expect(getTenantMigrationRoot(bundle)).toEqual({
      kind: 'standalone-client',
      profileId: CLIENT_PROFILE_ID,
    })

    const envelope = await encryptMigrationBundle(bundle, PASSPHRASE)
    expect(JSON.stringify(envelope)).not.toContain(CLIENT_PROFILE_ID)
    await expect(decryptMigrationBundle(envelope, PASSPHRASE)).resolves.toEqual(bundle)
  })

  it('binds a full-cohort fingerprint to the complete table snapshot', async () => {
    const bundle = buildFullCohortBundle()
    expect(getTenantMigrationRoot(bundle)).toEqual({
      kind: 'full-cohort',
      profileId: 'application-v1',
    })
    await expect(
      decryptMigrationBundle(
        await encryptMigrationBundle(bundle, PASSPHRASE),
        PASSPHRASE,
      ),
    ).resolves.toEqual(bundle)

    const changed = structuredClone(bundle)
    changed.tables[0] = buildMigrationTable('public.profiles', [])
    expect(() => readMigrationBundle(changed)).toThrowError(
      TenantMigrationArtifactError,
    )
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

  it('rejects an unsupported compression contract', async () => {
    const envelope = await encryptMigrationBundle(buildBundle(), PASSPHRASE)
    const malformed = {
      ...envelope,
      compression: { name: 'unknown' },
    }

    await expect(decryptMigrationBundle(malformed, PASSPHRASE)).rejects
      .toMatchObject({ code: 'artifact_invalid' })
  })

  it('rejects a short passphrase and mismatched tenant fingerprint', async () => {
    await expect(encryptMigrationBundle(buildBundle(), 'too-short')).rejects
      .toMatchObject({ code: 'passphrase_too_short' })
    const bundle = buildBundle()
    bundle.tenantFingerprint = '0000000000000000'
    expect(() => readMigrationBundle(bundle)).toThrowError(
      TenantMigrationArtifactError,
    )

    const standalone = buildStandaloneBundle()
    standalone.tenantFingerprint = fingerprintTenant(CLIENT_PROFILE_ID)
    expect(() => readMigrationBundle(standalone)).toThrowError(
      TenantMigrationArtifactError,
    )
  })
})
