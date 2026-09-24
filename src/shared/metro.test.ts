import { describe, expect, it } from 'vitest'

import { metroCityFromName, metroStationById, searchMetroStations } from './metro'

describe('Metro directory', () => {
  it('recognizes supported city names', () => {
    expect(metroCityFromName('Москва')).toBe('moscow')
    expect(metroCityFromName('Санкт-Петербург')).toBe('saint_petersburg')
    expect(metroCityFromName('г. Санкт-Петербург')).toBe('saint_petersburg')
    expect(metroCityFromName('СПб')).toBe('saint_petersburg')
    expect(metroCityFromName('Казань')).toBeNull()
  })

  it('limits search to the selected city', () => {
    expect(searchMetroStations('Пионерская', 'moscow').map((station) => station.id)).toEqual(['msk-pionerskaya'])
    expect(searchMetroStations('Пионерская', 'saint_petersburg').map((station) => station.id)).toEqual(['spb-pionerskaya'])
  })

  it('resolves old Moscow and new Saint Petersburg ids', () => {
    expect(metroStationById('msk-dinamo')?.name).toBe('Динамо')
    expect(metroStationById('spb-gorny-institut')?.name).toBe('Горный институт')
  })
})
