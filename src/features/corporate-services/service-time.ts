import { addDays, currentTimeInTimeZone, dayOfMonth, isValidTimeZone, localDate, todayInTimeZone, weekdayIndex } from '../../shared/local-date'
import type { CorporateServiceKind, ServiceRange } from '../../data/repositories/corporate-services.repository'

export const serviceLabels: Record<CorporateServiceKind, string> = { tour: 'Экскурсия', consultation: 'Консультация', instruction: 'Инструктаж', intro: 'Вводная тренировка' }
export const serviceKinds = ['tour', 'consultation', 'instruction', 'intro'] as const
export function servicePeriod(zone: string, period: 'today' | 'week' | 'month', now = new Date()): ServiceRange {
  const today = todayInTimeZone(zone, now)
  const from = period === 'week' ? addDays(today, -(weekdayIndex(today) + 6) % 7) : period === 'month' ? addDays(today, 1 - dayOfMonth(today)) : today
  return { from, until: addDays(today, 1) }
}
/** Resolve the account's wall time, never the device timezone. Preserve an unchanged instant in a DST fold. */
export function serviceInstant(date: string, time: string, zone: string, original?: string): string {
  localDate(date)
  if (!isValidTimeZone(zone) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Укажите корректные дату и время.')
  const matches = (at: Date) => todayInTimeZone(zone, at) === date && currentTimeInTimeZone(zone, at) === time
  if (original && matches(new Date(original))) return original
  const nominal = Date.parse(`${date}T${time}:00Z`)
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
  const offsets = new Set<number>()
  for (let h = -36; h <= 36; h += 6) {
    const offset = formatter.formatToParts(nominal + h * 3600000).find(p => p.type === 'timeZoneName')?.value
    const m = offset?.match(/^GMT([+-])(\d{2}):(\d{2})$/)
    if (offset === 'GMT') offsets.add(0)
    else if (m) offsets.add((m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])))
  }
  const candidates = [...offsets].map(minutes => new Date(nominal - minutes * 60000)).filter(matches)
  if (candidates.length !== 1) throw new Error('Это время пропущено или повторяется при переводе часов. Выберите другое время.')
  return candidates[0]!.toISOString()
}
export function serviceTimeLabel(at: string, zone: string) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: zone, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(at))
}
