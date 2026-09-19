import type { QueryResultRow } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
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
  certificates: [],
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
})
