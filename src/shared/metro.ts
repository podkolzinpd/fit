import {
  MOSCOW_METRO_STATIONS,
  normalizeMetroSearch,
  type MoscowMetroLine,
} from './moscow-metro'
import { SAINT_PETERSBURG_METRO_STATIONS } from './saint-petersburg-metro'

export type MetroCity = 'moscow' | 'saint_petersburg'

export interface MetroStation {
  id: string
  name: string
  lines: readonly MoscowMetroLine[]
  city: MetroCity
}

export const METRO_CITY_LABELS: Record<MetroCity, string> = {
  moscow: 'Москва',
  saint_petersburg: 'Санкт-Петербург',
}

const stationsByCity: Record<MetroCity, readonly MetroStation[]> = {
  moscow: MOSCOW_METRO_STATIONS.map((station) => ({ ...station, city: 'moscow' })),
  saint_petersburg: SAINT_PETERSBURG_METRO_STATIONS.map((station) => ({ ...station, city: 'saint_petersburg' })),
}

export const METRO_STATIONS = [...stationsByCity.moscow, ...stationsByCity.saint_petersburg] as const

const byId = new Map<string, MetroStation>(METRO_STATIONS.map((station) => [station.id, station]))

export function metroStationById(id: string): MetroStation | undefined {
  return byId.get(id)
}

export function metroCityFromName(value: string): MetroCity | null {
  const normalized = normalizeMetroSearch(value).replace(/[.,_-]+/g, ' ').replace(/\s+/g, ' ')
  if (/^(?:г|город)?\s*(?:санкт петербург|петербург|спб|питер|saint petersburg|st petersburg)(?:\s|$)/.test(normalized)) {
    return 'saint_petersburg'
  }
  if (/^(?:г|город)?\s*(?:москва|moscow)(?:\s|$)/.test(normalized)) return 'moscow'
  return null
}

export function searchMetroStations(query: string, city: MetroCity | null): readonly MetroStation[] {
  const normalized = normalizeMetroSearch(query)
  const stations = city === null ? METRO_STATIONS : stationsByCity[city]
  if (!normalized) return stations
  return stations.filter((station) => {
    const haystack = [station.name, ...station.lines.flatMap((line) => [line.code, line.name])]
      .map(normalizeMetroSearch).join(' ')
    return haystack.includes(normalized)
  })
}
