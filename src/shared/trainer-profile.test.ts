import { describe, expect, it } from 'vitest'
import { emptyTrainerProfileDraft, parseTrainerProfile, validatePublishableTrainerProfile } from './trainer-profile'

describe('trainer profile', () => {
  it('keeps incomplete drafts editable but blocks their publication', () => {
    const draft = emptyTrainerProfileDraft('Анна Иванова')
    expect(validatePublishableTrainerProfile(draft)).toBe('Расскажите о себе чуть подробнее — от 40 символов.')
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
      published: draft, updatedAt: '2026-09-10T09:37:38.59182+00:00',
      publishedAt: '2026-09-10T09:37:38.59182+00:00', version: 10 }).published).toEqual(draft)
  })
})
