import { describe, expect, it, vi, type Mock } from 'vitest'

import type { LegacyMediaObject, LegacyMediaSource } from './media-migration.js'
import { migrateMedia, readMediaMigrationMode } from './media-migration.js'
import type { MediaObjectStorage } from './object-storage-media.js'

const object: LegacyMediaObject = {
  contentType: 'image/jpeg',
  namespace: 'chat-media',
  path: 'conversation/message.jpg',
}
const bytes = Uint8Array.from([1, 2, 3])
const sha256 = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'

function source(): LegacyMediaSource {
  return {
    list: vi.fn().mockResolvedValue([object]),
    read: vi.fn().mockResolvedValue(bytes),
  }
}

function target(
  stat: Mock<MediaObjectStorage['stat']>,
) {
  return {
    read: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    sign: vi.fn().mockResolvedValue('https://storage.example/signed'),
    stat,
    write: vi.fn().mockResolvedValue(undefined),
  } satisfies MediaObjectStorage
}

describe('migrateMedia', () => {
  it('audits source bytes and target parity without writing', async () => {
    const storage = target(
      vi.fn<MediaObjectStorage['stat']>()
        .mockResolvedValue({ sizeBytes: 3, sha256 }),
    )

    const report = await migrateMedia(source(), storage, 'audit')

    expect(report).toMatchObject({ bytes: 3, copied: 0, objects: 1, verified: 1 })
    expect(report.fingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('copies a missing object and validates the stored checksum', async () => {
    const stat = vi.fn<MediaObjectStorage['stat']>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ sizeBytes: 3, sha256 })
    const storage = target(stat)

    const report = await migrateMedia(source(), storage, 'apply')

    expect(report).toMatchObject({ bytes: 3, copied: 1, objects: 1, verified: 1 })
    expect(storage.write).toHaveBeenCalledWith(
      'chat-media',
      object.path,
      bytes,
      'image/jpeg',
      true,
    )
  })

  it('fails apply when the target cannot reproduce the exact object', async () => {
    const storage = target(
      vi.fn<MediaObjectStorage['stat']>().mockResolvedValue(undefined),
    )
    await expect(migrateMedia(source(), storage, 'apply'))
      .rejects.toThrow('target_media_validation_failed')
  })
})

describe('readMediaMigrationMode', () => {
  it('allows only explicit read-only audit or idempotent apply', () => {
    expect(readMediaMigrationMode('audit')).toBe('audit')
    expect(readMediaMigrationMode('apply')).toBe('apply')
    expect(() => readMediaMigrationMode(undefined))
      .toThrow('media_migration_mode_invalid')
  })
})
