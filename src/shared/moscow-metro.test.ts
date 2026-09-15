import { describe, expect, it } from 'vitest'

import { MOSCOW_METRO_STATIONS, moscowMetroStationById, searchMoscowMetroStations } from './moscow-metro'

describe('Moscow metro directory', () => {
  it('contains the current metro network without surface rail lines', () => {
    expect(MOSCOW_METRO_STATIONS).toHaveLength(244)
    expect(MOSCOW_METRO_STATIONS.some((station) => station.name === 'Вавиловская')).toBe(true)
    expect(MOSCOW_METRO_STATIONS.some((station) => station.name === 'Бульвар Генерала Карбышева')).toBe(true)
    expect(MOSCOW_METRO_STATIONS.some((station) => station.lines.some((line) => String(line.name) === 'МЦК'))).toBe(false)
  })

  it('uses unique stable ids and resolves every station by id', () => {
    const ids = MOSCOW_METRO_STATIONS.map((station) => station.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => moscowMetroStationById(id)?.id === id)).toBe(true)
  })

  it('searches names without depending on the letter yo', () => {
    expect(searchMoscowMetroStations('савеловская').map((station) => station.name)).toContain('Савёловская')
    expect(searchMoscowMetroStations('троицкая').some((station) => station.name === 'Вавиловская')).toBe(true)
  })
})
