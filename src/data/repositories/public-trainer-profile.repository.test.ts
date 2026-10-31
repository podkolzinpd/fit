import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyTrainerProfileDraft } from '../../shared/trainer-profile'
import { forgetPublicTrainerProfile, getPublicTrainerProfile } from './public-trainer-profile.repository'

const query = vi.hoisted(() => vi.fn())
vi.mock('../queries/public-trainer-profile.queries', () => ({ publicTrainerProfileQuery: query, localPublicTrainerProfileQuery: vi.fn() }))
const id = '10000000-0000-4000-8000-000000000001'
const draft = emptyTrainerProfileDraft('Тестовый тренер')
const profile = { publicId: id, draft, published: draft, isBrandTrainer: false, listedInCatalog: true,
  publishedAt: '2026-10-29T09:00:00Z', updatedAt: '2026-10-29T09:00:00Z', version: 1 }

describe('public profile administrative metadata refresh', () => {
  beforeEach(() => {
    query.mockReset(); forgetPublicTrainerProfile(id)
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'fixture')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('refreshes changed offices even when the published profile version did not change', async () => {
    query.mockResolvedValueOnce(Response.json({ ...profile, yandexOffices: [{ city: 'Москва', name: 'Офис' }] }))
    query.mockResolvedValueOnce(Response.json({ ...profile, yandexOffices: [] }))
    expect((await getPublicTrainerProfile(id))?.yandexOffices).toHaveLength(1)
    expect((await getPublicTrainerProfile(id))?.yandexOffices).toHaveLength(1)
    expect(query).toHaveBeenCalledTimes(1)
    expect((await getPublicTrainerProfile(id, { fresh: true }))?.yandexOffices).toEqual([])
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('does not retain an approved badge as fallback after a failed fresh read', async () => {
    query.mockResolvedValueOnce(Response.json({ ...profile, yandexOffices: [{ city: 'Москва', name: 'Офис' }] }))
    await getPublicTrainerProfile(id)
    query.mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 503 }))
    await expect(getPublicTrainerProfile(id, { fresh: true })).rejects.toThrow()
    query.mockResolvedValueOnce(Response.json({ ...profile, yandexOffices: [] }))
    expect((await getPublicTrainerProfile(id))?.yandexOffices).toEqual([])
  })
})
