import { describe, expect, it } from 'vitest'
import { emptyTrainerProfileDraft, parseLegacyTrainerCatalogPage, parseTrainerCatalogPage, parseTrainerProfile, TRAINER_SPECIALTIES, TRAINER_SPECIALTIES_MAX, validatePublishableTrainerProfile } from './trainer-profile'

describe('trainer profile', () => {
  it('allows a trainer to publish a profile with only the account name', () => {
    const draft = emptyTrainerProfileDraft('Анна Иванова')
    expect(validatePublishableTrainerProfile(draft)).toBeNull()
  })

  it('still requires a readable trainer name', () => {
    expect(validatePublishableTrainerProfile(emptyTrainerProfileDraft('А'))).toBe('Укажите имя тренера.')
  })

  it('accepts a complete profile and its published snapshot', () => {
    const draft = {
      ...emptyTrainerProfileDraft('Анна Иванова'),
      bio: 'Помогаю безопасно начать силовые тренировки и видеть понятный прогресс.',
      specialties: ['Силовые'],
      trainingModes: ['online' as const],
    }
    expect(validatePublishableTrainerProfile(draft)).toBeNull()
    expect(parseTrainerProfile({
      publicId: '11111111-1111-4111-8111-111111111111',
      draft,
      published: draft,
      listedInCatalog: false,
      publishedAt: '2026-09-10T09:00:00.000Z',
      updatedAt: '2026-09-10T09:00:00.044607+00:00',
      version: 2,
      isBrandTrainer: false,
    }).published?.displayName).toBe('Анна Иванова')
  })

  it('accepts PostgreSQL timestamps returned by the public RPC', () => {
    const draft = {
      ...emptyTrainerProfileDraft('Анна Иванова'),
      bio: 'Помогаю безопасно начать силовые тренировки и видеть понятный прогресс.',
      specialties: ['Силовые', 'снижение веса'], trainingModes: ['online' as const], city: 'Москва',
    }
    expect(parseTrainerProfile({ publicId: '9190a86f-a191-42d8-912e-a7e0ea0f331d', draft,
      published: draft, listedInCatalog: true, updatedAt: '2026-09-10T09:37:38.59182+00:00',
      publishedAt: '2026-09-10T09:37:38.59182+00:00', version: 10, isBrandTrainer: false }).published).toEqual(draft)
  })

  it('maps the legacy Supabase catalog response to the compact public contract', () => {
    const published = emptyTrainerProfileDraft('Анна Иванова')
    const draft = { ...published, displayName: 'Неопубликованное имя' }
    const page = parseLegacyTrainerCatalogPage({
      items: [{
        publicId: '9190a86f-a191-42d8-912e-a7e0ea0f331d',
        draft,
        published,
        listedInCatalog: true,
        updatedAt: '2026-09-10T09:37:38.59182+00:00',
        publishedAt: '2026-09-10T09:37:38.59182+00:00',
        version: 10,
        isBrandTrainer: false,
      }],
      totalCount: 1,
      nextOffset: null,
    })

    expect(page.items).toEqual([{
      publicId: '9190a86f-a191-42d8-912e-a7e0ea0f331d',
      profile: published,
      isBrandTrainer: false,
    }])
  })

  it('rejects the old duplicated profile shape from the Yandex catalog contract', () => {
    const profile = emptyTrainerProfileDraft('Анна Иванова')
    expect(() => parseTrainerCatalogPage({
      items: [{
        publicId: '9190a86f-a191-42d8-912e-a7e0ea0f331d',
        draft: profile,
        published: profile,
        isBrandTrainer: false,
      }],
      totalCount: 1,
      nextOffset: null,
    })).toThrow()
  })

  it('reads a filled legacy profile without rewriting its existing fields', () => {
    const current = {
      ...emptyTrainerProfileDraft('Анна Иванова'),
      bio: 'Существующее описание',
      city: 'Москва',
      price: 'От 3 000 ₽',
      trainingModes: ['in_person' as const],
    }
    const legacy: Record<string, unknown> = { ...current }
    delete legacy.metroStationIds
    delete legacy.customLocations
    delete legacy.photos
    const profile = parseTrainerProfile({
      publicId: '9190a86f-a191-42d8-912e-a7e0ea0f331d',
      draft: legacy,
      published: legacy,
      listedInCatalog: true,
      updatedAt: '2026-09-15T09:37:38.59182+00:00',
      publishedAt: '2026-09-10T09:37:38.59182+00:00',
      version: 10,
      isBrandTrainer: false,
    })

    expect(profile.published).toEqual({ ...legacy, metroStationIds: [], customLocations: [], photos: [] })
    expect(profile.listedInCatalog).toBe(true)
  })

  it('still reads a profile that picked more specialties before the six-item limit existed', () => {
    const legacySpecialties = [...TRAINER_SPECIALTIES].slice(0, TRAINER_SPECIALTIES_MAX + 2)
    const draft = { ...emptyTrainerProfileDraft('Анна Иванова'), specialties: legacySpecialties }
    const profile = parseTrainerProfile({
      publicId: '9190a86f-a191-42d8-912e-a7e0ea0f331d',
      draft, published: draft, listedInCatalog: false,
      updatedAt: '2026-09-10T09:37:38.59182+00:00', publishedAt: null, version: 1, isBrandTrainer: false,
    })
    expect(profile.draft.specialties).toHaveLength(TRAINER_SPECIALTIES_MAX + 2)
  })

  it('blocks publishing a profile with more than six specialties', () => {
    const draft = {
      ...emptyTrainerProfileDraft('Анна Иванова'),
      specialties: [...TRAINER_SPECIALTIES].slice(0, TRAINER_SPECIALTIES_MAX + 1),
    }
    expect(validatePublishableTrainerProfile(draft)).toBe(`Оставьте не больше ${TRAINER_SPECIALTIES_MAX} направлений.`)
  })

  it('recovers a legacy draft with an entirely empty certificate row', () => {
    const draft = {
      ...emptyTrainerProfileDraft('Анна Иванова'),
      certificates: [{ title: '', organization: '', year: null }],
    }
    const profile = parseTrainerProfile({
      publicId: '9190a86f-a191-42d8-912e-a7e0ea0f331d',
      draft,
      published: null,
      listedInCatalog: false,
      updatedAt: '2026-09-10T09:37:38.59182+00:00',
      publishedAt: null,
      version: 1,
      isBrandTrainer: false,
    })
    expect(profile.draft.certificates).toEqual([])
  })
})
