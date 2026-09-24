import { describe, expect, it } from 'vitest'

import { SAINT_PETERSBURG_METRO_STATIONS, saintPetersburgMetroStationById } from './saint-petersburg-metro'

describe('Saint Petersburg metro directory', () => {
  it('contains all current named locations and the sixth line', () => {
    expect(SAINT_PETERSBURG_METRO_STATIONS).toHaveLength(73)
    expect(SAINT_PETERSBURG_METRO_STATIONS.some((station) => station.name === 'Горный институт')).toBe(true)
    expect(SAINT_PETERSBURG_METRO_STATIONS.some((station) => station.name === 'Юго-Западная')).toBe(true)
    expect(SAINT_PETERSBURG_METRO_STATIONS.some((station) => station.name === 'Путиловская')).toBe(true)
  })

  it('uses unique stable ids and resolves every station by id', () => {
    const ids = SAINT_PETERSBURG_METRO_STATIONS.map((station) => station.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => saintPetersburgMetroStationById(id)?.id === id)).toBe(true)
  })

  it('combines same-name transfer locations', () => {
    expect(saintPetersburgMetroStationById('spb-tehnologicheskiy-institut')?.lines.map((line) => line.code)).toEqual(['1', '2'])
    expect(saintPetersburgMetroStationById('spb-ploschad-aleksandra-nevskogo')?.lines.map((line) => line.code)).toEqual(['3', '4'])
  })
})
