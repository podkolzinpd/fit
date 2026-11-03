import type { ServiceRange } from '../../data/repositories/corporate-services.repository'
import { addDays, localDate, todayInTimeZone } from '../../shared/local-date'
import { servicePeriod } from './service-time'

export const servicesRoot = '/profile/yandex-services'
export function historyRange(params: URLSearchParams, zone: string): ServiceRange {
  try {
    const from = localDate(params.get('from') ?? ''), until = localDate(params.get('until') ?? '')
    const days = (Date.parse(until) - Date.parse(from)) / 86400000
    if (days > 0 && days <= 93) return { from, until }
  } catch { /* Invalid external dates use the ordinary month, never an invalid API request. */ }
  return servicePeriod(zone, 'month')
}
export function rangeSearch(range: ServiceRange) { return new URLSearchParams({ ...range }).toString() }
export function savedRange(range: ServiceRange, occurredAt: string, zone: string): ServiceRange {
  const day = todayInTimeZone(zone, new Date(occurredAt))
  return day >= range.from && day < range.until ? range : { from: day, until: addDays(day, 1) }
}
