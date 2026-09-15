import { describe, expect, it } from 'vitest'

import { readTrainerProfileDraft } from './trainer-profile.js'

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
