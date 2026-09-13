import { describe, expect, it } from 'vitest'
import { emptyTrainerProfileDraft, parseTrainerProfile, validatePublishableTrainerProfile } from './trainer-profile'

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
      publishedAt: '2026-09-10T09:37:38.59182+00:00', version: 10 }).published).toEqual(draft)
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
    })
    expect(profile.draft.certificates).toEqual([])
  })
})
