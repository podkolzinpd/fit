import type { QueryResultRow } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
import type { MediaObjectStorage } from './object-storage-media.js'
import { DatabasePilotTrainerProfiles, readTrainerProfileDraft } from './trainer-profile.js'

const minimalProfile = {
  displayName: 'Анна',
  bio: '',
  specialties: [],
  city: '',
  trainingModes: [],
  experienceStartYear: null,
  education: '',
  formats: '',
  price: '',
  acceptingClients: false,
  avatarDataUrl: null,
  photos: [],
  certificates: [],
}

function media() {
  return {
    read: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    sign: vi.fn((_namespace, path: string) => Promise.resolve(`https://storage.example/${path}?signed=1`)),
    stat: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
  } satisfies MediaObjectStorage
}

function poolWithRows(rows: readonly unknown[][]): {
  pool: DatabasePool
  query: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
} {
  const pending = [...rows]
  const query = vi.fn((text: string, values?: readonly unknown[]) => {
    void text
    void values
    return Promise.resolve(pending.shift() ?? [])
  })
  const release = vi.fn()
  const connection: DatabaseConnection = {
    query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => (
      await query(text, values) as readonly Row[]
    ),
    release,
  }
  const pool: DatabasePool = {
    connect: () => Promise.resolve(connection),
    end: () => Promise.resolve(),
  }
  return { pool, query, release }
}

function transactionPool(handler: (text: string, values?: readonly unknown[]) => readonly unknown[]) {
  const actorId = '33333333-3333-4333-8333-333333333333'
  const query = vi.fn((text: string, values?: readonly unknown[]) => {
    if (text === 'begin' || text === 'commit' || text === 'rollback' || text.includes("set_config('request.jwt.claim.sub'")) {
      return Promise.resolve([])
    }
    if (text.includes('resolve_yandex_app_session')) return Promise.resolve([{ profile_id: actorId }])
    return Promise.resolve(handler(text, values))
  })
  const connection: DatabaseConnection = {
    query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => (
      await query(text, values) as readonly Row[]
    ),
    release: vi.fn(),
  }
  const pool: DatabasePool = { connect: () => Promise.resolve(connection), end: () => Promise.resolve() }
  return { pool, query }
}

describe('trainer profile draft', () => {
  it('accepts a profile with only the account name', () => {
    expect(readTrainerProfileDraft(minimalProfile)).toEqual({
      ...minimalProfile,
      metroStationIds: [],
      customLocations: [],
    })
  })

  it('accepts metro stations and manually entered locations', () => {
    expect(readTrainerProfileDraft({
      ...minimalProfile,
      metroStationIds: ['msk-dinamo', 'msk-aeroport'],
      customLocations: ['Клуб на Ленинградском проспекте'],
    })).toMatchObject({
      metroStationIds: ['msk-dinamo', 'msk-aeroport'],
      customLocations: ['Клуб на Ленинградском проспекте'],
    })
  })

  it('still rejects a profile without a usable name', () => {
    expect(readTrainerProfileDraft({ ...minimalProfile, displayName: 'А' })).toBeUndefined()
  })
})

describe('public trainer profiles', () => {
  const publicId = '11111111-1111-4111-8111-111111111111'
  const published = {
    ...minimalProfile,
    metroStationIds: [],
    customLocations: [],
  }

  it('never exposes an unpublished draft through the public profile endpoint', async () => {
    const { pool, query, release } = poolWithRows([{
      public_id: publicId,
      draft_data: { ...published, displayName: 'Неопубликованное имя' },
      published_data: published,
      listed_in_catalog: true,
      published_at: '2026-09-20T10:00:00.000Z',
      updated_at: '2026-09-20T10:00:00.000Z',
      version: 2,
      is_brand_trainer: false,
    }].map((row) => [row]))

    await expect(new DatabasePilotTrainerProfiles(pool).getPublic(publicId)).resolves.toMatchObject({
      draft: published,
      published,
    })
    expect(query.mock.calls[0]?.[0]).not.toContain('select *')
    expect(query.mock.calls[0]?.[0]).not.toContain('draft_data')
    expect(release).toHaveBeenCalledOnce()
  })

  it('returns a compact bounded catalog response below the Yandex response limit', async () => {
    const prefix = 'data:image/png;base64,'
    const largeProfile = {
      ...published,
      avatarDataUrl: prefix + 'a'.repeat(900_000 - prefix.length),
    }
    const rows = Array.from({ length: 3 }, (_, index) => ({
      public_id: `11111111-1111-4111-8111-11111111111${index}`,
      draft_data: { ...largeProfile, displayName: 'Неопубликованное имя' },
      published_data: largeProfile,
      is_brand_trainer: false,
    }))
    const { pool, query, release } = poolWithRows([
      [{ total: '3' }],
      rows,
    ])

    const page = await new DatabasePilotTrainerProfiles(pool).listPublic({
      query: '', specialties: [], city: '', metroStationIds: [], mode: '', acceptingClients: null, brandTrainerOnly: false,
    }, { offset: 0, limit: 20 })

    expect(page.items).toHaveLength(3)
    expect(page.items[0]).toEqual({ publicId: rows[0]?.public_id, profile: largeProfile, isBrandTrainer: false })
    expect(page.items[0]).not.toHaveProperty('draft')
    expect(page.items[0]).not.toHaveProperty('published')
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(3_670_016)
    expect(query.mock.calls[1]?.[0]).not.toContain('select *')
    expect(query.mock.calls[1]?.[0]).not.toContain('draft_data')
    expect(query.mock.calls[1]?.[1]).toEqual([0, 3])
    expect(release).toHaveBeenCalledOnce()
  })

  it('returns a full signed photo publicly and only a signed thumbnail in catalog', async () => {
    const storedPhoto = {
      id: '22222222-2222-4222-8222-222222222222',
      path: 'trainer/photo/full.jpg',
      thumbnailPath: 'trainer/photo/thumbnail.jpg',
      mimeType: 'image/jpeg' as const,
      width: 1200,
      height: 1600,
      sizeBytes: 400_000,
      thumbnailWidth: 360,
      thumbnailHeight: 480,
      thumbnailSizeBytes: 40_000,
    }
    const stored = { ...published, photos: [storedPhoto] }
    const row = {
      public_id: publicId,
      published_data: stored,
      listed_in_catalog: true,
      published_at: '2026-09-20T10:00:00.000Z',
      updated_at: '2026-09-20T10:00:00.000Z',
      version: 2,
      is_brand_trainer: false,
    }
    const publicPool = poolWithRows([[row]])
    const publicStorage = media()

    const publicProfile = await new DatabasePilotTrainerProfiles(publicPool.pool, publicStorage).getPublic(publicId)

    const publicPhoto = publicProfile?.published?.photos[0]
    expect(publicPhoto?.id).toBe(storedPhoto.id)
    expect(publicPhoto?.url).toContain('/full.jpg')
    expect(publicPhoto?.thumbnailUrl).toContain('/thumbnail.jpg')

    const catalogPool = poolWithRows([[{ total: '1' }], [row]])
    const catalogStorage = media()
    const catalog = await new DatabasePilotTrainerProfiles(catalogPool.pool, catalogStorage).listPublic({
      query: '', specialties: [], city: '', metroStationIds: [], mode: '', acceptingClients: null, brandTrainerOnly: false,
    }, { offset: 0, limit: 3 })

    const catalogPhoto = catalog.items[0]?.profile.photos[0]
    expect(catalogPhoto?.id).toBe(storedPhoto.id)
    expect(catalogPhoto?.url).toBeNull()
    expect(catalogPhoto?.thumbnailUrl).toContain('/thumbnail.jpg')
    expect(catalogStorage.sign).toHaveBeenCalledOnce()
    expect(catalogStorage.sign).toHaveBeenCalledWith('trainer-profile-media', storedPhoto.thumbnailPath)
  })
})

describe('trainer profile photo snapshots', () => {
  const storedPhoto = {
    id: '22222222-2222-4222-8222-222222222222',
    path: 'trainer/photo/full.jpg',
    thumbnailPath: 'trainer/photo/thumbnail.jpg',
    mimeType: 'image/jpeg' as const,
    width: 1200,
    height: 1600,
    sizeBytes: 400_000,
    thumbnailWidth: 360,
    thumbnailHeight: 480,
    thumbnailSizeBytes: 40_000,
  }
  const storedBase = { ...minimalProfile, metroStationIds: [], customLocations: [] }
  const row = {
    public_id: '11111111-1111-4111-8111-111111111111',
    draft_data: { ...storedBase, photos: [storedPhoto] },
    published_data: { ...storedBase, photos: [storedPhoto] },
    listed_in_catalog: true,
    published_at: '2026-09-20T10:00:00.000Z',
    updated_at: '2026-09-20T10:00:00.000Z',
    version: 2,
    is_brand_trainer: false,
  }
  const session = { accessMode: 'read_write' as const, token: 'a'.repeat(43) }

  it('keeps an object while the published snapshot still references it', async () => {
    const updated = { ...row, draft_data: { ...storedBase, photos: [] }, version: 3 }
    const database = transactionPool((text) => {
      if (text.includes('for update')) return [row]
      if (text.includes('update public.trainer_professional_profiles')) return [updated]
      return []
    })
    const storage = media()

    const result = await new DatabasePilotTrainerProfiles(database.pool, storage).deletePhoto(session, storedPhoto.id)

    expect(result.draft.photos).toEqual([])
    expect(result.published?.photos).toHaveLength(1)
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('releases a deleted draft-only object immediately', async () => {
    const unpublished = { ...row, published_data: null, listed_in_catalog: false, published_at: null }
    const updated = { ...unpublished, draft_data: { ...storedBase, photos: [] }, version: 3 }
    const database = transactionPool((text) => {
      if (text.includes('for update')) return [unpublished]
      if (text.includes('update public.trainer_professional_profiles')) return [updated]
      return []
    })
    const storage = media()

    await new DatabasePilotTrainerProfiles(database.pool, storage).deletePhoto(session, storedPhoto.id)

    expect(storage.remove).toHaveBeenCalledTimes(2)
    expect(storage.remove).toHaveBeenCalledWith('trainer-profile-media', storedPhoto.path)
    expect(storage.remove).toHaveBeenCalledWith('trainer-profile-media', storedPhoto.thumbnailPath)
  })

  it('removes an orphan only after a new snapshot is published', async () => {
    const current = { ...row, draft_data: { ...storedBase, photos: [] } }
    const updated = { ...current, published_data: current.draft_data, version: 3 }
    const database = transactionPool((text) => {
      if (text.includes('for update')) return [current]
      if (text.includes('update public.trainer_professional_profiles')) return [updated]
      return []
    })
    const storage = media()

    await new DatabasePilotTrainerProfiles(database.pool, storage).publish(session)

    expect(storage.remove).toHaveBeenCalledTimes(2)
    expect(storage.remove).toHaveBeenCalledWith('trainer-profile-media', storedPhoto.path)
    expect(storage.remove).toHaveBeenCalledWith('trainer-profile-media', storedPhoto.thumbnailPath)
  })
})
