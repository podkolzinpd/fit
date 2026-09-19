import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: null as { apiBaseUrl: string; clientId: string } | null,
  rpc: vi.fn(),
}))

vi.mock('../../app/feature-flags', () => ({
  getYandexMainRoutingConfig: () => mocks.config,
}))
vi.mock('../queries/client', () => ({
  supabase: { rpc: mocks.rpc },
}))

import { forgetPublicTrainerProfile, getPublicTrainerProfile } from './trainer-profiles.repository'

const publicId = '1594d7d6-9532-494f-8497-b0745de99ab0'
const profile = {
  publicId,
  draft: {
    displayName: 'Анна Иванова', bio: '', specialties: [], city: '', metroStationIds: [], customLocations: [],
    trainingModes: [], experienceStartYear: null, education: '', formats: '', price: '', acceptingClients: true,
    avatarDataUrl: null, certificates: [],
  },
  published: {
    displayName: 'Анна Иванова', bio: '', specialties: [], city: '', metroStationIds: [], customLocations: [],
    trainingModes: [], experienceStartYear: null, education: '', formats: '', price: '', acceptingClients: true,
    avatarDataUrl: null, certificates: [],
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
    mocks.rpc.mockReset()
    vi.unstubAllGlobals()
    forgetPublicTrainerProfile(publicId)
  })

  it('reads only Supabase while Yandex main routing is disabled', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    mocks.rpc.mockResolvedValue({ data: profile, error: null })

    await expect(getPublicTrainerProfile(publicId)).resolves.toEqual(profile)
    expect(mocks.rpc).toHaveBeenCalledWith('get_public_trainer_profile', { p_public_id: publicId })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads only Yandex when main routing is enabled', async () => {
    mocks.config = { apiBaseUrl: 'https://api.example.test', clientId: 'client-id' }
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(profile), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)

    await expect(getPublicTrainerProfile(publicId)).resolves.toEqual(profile)
    expect(fetch).toHaveBeenCalledWith(`https://api.example.test/v1/trainers/${publicId}/public-profile`)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('returns an unavailable profile from Yandex without falling back to Supabase', async () => {
    mocks.config = { apiBaseUrl: 'https://api.example.test', clientId: 'client-id' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })))

    await expect(getPublicTrainerProfile(publicId)).resolves.toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('surfaces a Yandex outage without falling back to Supabase', async () => {
    mocks.config = { apiBaseUrl: 'https://api.example.test', clientId: 'client-id' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'service_unavailable' }), { status: 503 })))

    await expect(getPublicTrainerProfile(publicId)).rejects.toMatchObject({ code: 'service_unavailable' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
