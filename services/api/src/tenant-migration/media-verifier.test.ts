import { describe, expect, it, vi } from 'vitest'

import type { MediaObjectStorage } from '../object-storage-media.js'
import { buildMigrationTable, fingerprintFullCohort } from './bundle.js'
import {
  chatMediaReferences,
  ObjectStorageTenantMigrationMediaVerifier,
} from './media-verifier.js'
import type { FullCohortMigrationBundle, JsonObject } from './types.js'

function buildBundle(rows: JsonObject[]): FullCohortMigrationBundle {
  const tables = [buildMigrationTable('public.chat_messages', rows)]
  return {
    createdAt: '2026-09-14T00:00:00.000Z',
    format: 'fit-full-cohort-bundle-v1',
    tables,
    tenantFingerprint: fingerprintFullCohort(tables),
  }
}

function buildStorage(
  stat: MediaObjectStorage['stat'],
): MediaObjectStorage {
  return {
    read: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    sign: vi.fn().mockResolvedValue('https://storage.example/signed'),
    stat,
    write: vi.fn().mockResolvedValue(undefined),
  }
}

describe('chatMediaReferences', () => {
  it('extracts and deduplicates only complete photo references', () => {
    const bundle = buildBundle([
      { id: 'one', image_path: null, image_size_bytes: null },
      { id: 'two', image_path: 'conversation/photo.jpg', image_size_bytes: 123 },
      { id: 'three', image_path: 'conversation/photo.jpg', image_size_bytes: 123 },
    ])

    expect(chatMediaReferences(bundle)).toEqual([
      { path: 'conversation/photo.jpg', sizeBytes: 123 },
    ])
  })

  it('rejects incomplete media metadata', () => {
    const bundle = buildBundle([
      { id: 'one', image_path: 'conversation/photo.jpg', image_size_bytes: null },
    ])
    expect(() => chatMediaReferences(bundle)).toThrow('tenant_media_contract_invalid')
  })
})

describe('ObjectStorageTenantMigrationMediaVerifier', () => {
  it('accepts a bundle only when every referenced object has the exact size', async () => {
    const stat = vi.fn().mockResolvedValue({ sizeBytes: 123 })
    const verifier = new ObjectStorageTenantMigrationMediaVerifier(buildStorage(stat))
    const bundle = buildBundle([
      { id: 'one', image_path: 'conversation/photo.jpg', image_size_bytes: 123 },
    ])

    await expect(verifier.verify(bundle)).resolves.toBeUndefined()
    expect(stat).toHaveBeenCalledWith('chat-media', 'conversation/photo.jpg')
  })

  it.each([
    [undefined, 'tenant_media_missing'],
    [{ sizeBytes: 122 }, 'tenant_media_missing'],
  ])('rejects missing or mismatched objects', async (stored, code) => {
    const verifier = new ObjectStorageTenantMigrationMediaVerifier(
      buildStorage(vi.fn().mockResolvedValue(stored)),
    )
    const bundle = buildBundle([
      { id: 'one', image_path: 'conversation/photo.jpg', image_size_bytes: 123 },
    ])

    await expect(verifier.verify(bundle)).rejects.toThrow(code)
  })

  it('maps transport errors to a safe migration code', async () => {
    const verifier = new ObjectStorageTenantMigrationMediaVerifier(
      buildStorage(vi.fn().mockRejectedValue(new Error('secret path'))),
    )
    const bundle = buildBundle([
      { id: 'one', image_path: 'conversation/photo.jpg', image_size_bytes: 123 },
    ])

    await expect(verifier.verify(bundle))
      .rejects.toThrow('tenant_media_validation_failed')
  })
})
