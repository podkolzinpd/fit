import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: null as { apiBaseUrl: string; clientId: string } | null,
}))

vi.mock('../../app/feature-flags', () => ({
  getYandexMainRoutingConfig: () => mocks.config,
}))


import { forgetPublicTrainerProfile, getPublicTrainerProfile } from './public-trainer-profile.repository'

const publicId = '1594d7d6-9532-494f-8497-b0745de99ab0'
const profile = {
  publicId,
  draft: {
    displayName: 'Анна Иванова', bio: '', specialties: [], city: '', metroStationIds: [], customLocations: [],
    trainingModes: [], experienceStartYear: null, education: '', formats: '', price: '', acceptingClients: true,
    avatarDataUrl: null, photos: [], certificates: [],
  },
  published: {
    displayName: 'Анна Иванова', bio: '', specialties: [], city: '', metroStationIds: [], customLocations: [],
    trainingModes: [], experienceStartYear: null, education: '', formats: '', price: '', acceptingClients: true,
    avatarDataUrl: null, photos: [], certificates: [],
  },
  listedInCatalog: true,
  publishedAt: '2026-09-19T10:00:00.000Z',
  updatedAt: '2026-09-19T10:00:00.000Z',
  version: 1,
  isBrandTrainer: false,
}

describe('public trainer profile backend selection', () => {
  beforeEach(() => {
    mocks.config = null
    vi.unstubAllGlobals()
    forgetPublicTrainerProfile(publicId)
  })





  it('reads only Yandex when main routing is enabled', async () => {
    mocks.config = { apiBaseUrl: 'https://api.example.test', clientId: 'client-id' }
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(profile), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)

    await expect(getPublicTrainerProfile(publicId)).resolves.toEqual(profile)
    expect(fetch).toHaveBeenCalledWith(`https://api.example.test/v1/trainers/${publicId}/public-profile`, { cache: 'no-store' })
  })

  it('refreshes Yandex signed photo links before their one-hour expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T10:00:00.000Z'))
    try {
      mocks.config = { apiBaseUrl: 'https://api.example.test', clientId: 'client-id' }
      const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(profile), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })))
      vi.stubGlobal('fetch', fetch)

      await getPublicTrainerProfile(publicId)
      await getPublicTrainerProfile(publicId)
      expect(fetch).toHaveBeenCalledOnce()

      vi.advanceTimersByTime(46 * 60 * 1_000)
      await getPublicTrainerProfile(publicId)
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns an unavailable profile from Yandex without falling back to Supabase', async () => {
    mocks.config = { apiBaseUrl: 'https://api.example.test', clientId: 'client-id' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })))

    await expect(getPublicTrainerProfile(publicId)).resolves.toBeNull()
  })

  it('surfaces a Yandex outage without falling back to Supabase', async () => {
    mocks.config = { apiBaseUrl: 'https://api.example.test', clientId: 'client-id' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'service_unavailable' }), { status: 503 })))

    await expect(getPublicTrainerProfile(publicId)).rejects.toMatchObject({ code: 'service_unavailable' })
  })






})
