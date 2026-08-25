declare const localDateBrand: unique symbol

export type LocalDate = string & { readonly [localDateBrand]: true }

const pattern = /^\d{4}-\d{2}-\d{2}$/

export const DEFAULT_TIME_ZONE = 'Europe/Moscow'

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

export function systemTimeZone(): string {
  const value = Intl.DateTimeFormat().resolvedOptions().timeZone
  return value && isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE
}

export function normalizeTimeZone(value?: string | null): string {
  return value && isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE
}

export function localDate(value: string): LocalDate {
  if (!pattern.test(value)) throw new Error('Дата должна иметь формат YYYY-MM-DD')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error('Некорректная календарная дата')
  }
  return value as LocalDate
}

export function todayInTimeZone(timeZone?: string | null, now = new Date()): LocalDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return localDate(`${value.year}-${value.month}-${value.day}`)
}

export function currentTimeInTimeZone(timeZone?: string | null, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: normalizeTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.hour}:${value.minute}`
}

export function todayLocalDate(now = new Date()): LocalDate {
  return todayInTimeZone(systemTimeZone(), now)
}

export function formatLocalDate(value: LocalDate, locale = 'ru-RU'): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(year ?? 0, (month ?? 1) - 1, day))
}

// Compact numeric date (e.g. 23.07.2026) for tight spots like stat tiles.
export function formatLocalDateShort(value: LocalDate, locale = 'ru-RU'): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(year ?? 0, (month ?? 1) - 1, day))
}

function parts(value: LocalDate): [number, number, number] {
  const [year, month, day] = value.split('-').map(Number)
  return [year ?? 0, month ?? 1, day ?? 1]
}

function fromUtc(timestamp: number): LocalDate {
  const date = new Date(timestamp)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return localDate(`${year}-${month}-${day}`)
}

export function addDays(value: LocalDate, days: number): LocalDate {
  const [year, month, day] = parts(value)
  return fromUtc(Date.UTC(year, month - 1, day + days))
}

// Календарных дней от from до to (to - from). Отрицательно, если to раньше from.
export function daysBetween(from: LocalDate, to: LocalDate): number {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

export function addMonths(value: LocalDate, months: number): LocalDate {
  const [year, month, day] = parts(value)
  // Clamp to the last day of the target month (e.g. 31 Jan + 1 month → 28/29 Feb).
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return fromUtc(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay)))
}

// Week starts on Sunday (matches the weekday strip ВС..СБ).
export function startOfWeek(value: LocalDate): LocalDate {
  const [year, month, day] = parts(value)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0=Sun..6=Sat
  return addDays(value, -weekday)
}

export function endOfWeek(value: LocalDate): LocalDate {
  return addDays(startOfWeek(value), 6)
}

export function startOfMonth(value: LocalDate): LocalDate {
  const [year, month] = parts(value)
  return fromUtc(Date.UTC(year, month - 1, 1))
}

export function endOfMonth(value: LocalDate): LocalDate {
  const [year, month] = parts(value)
  return fromUtc(Date.UTC(year, month, 0))
}

export function formatWeekRange(from: LocalDate, to: LocalDate, locale = 'ru-RU'): string {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' })
  const start = dayMonth.format(new Date(fy, fm - 1, fd))
  const end = dayMonth.format(new Date(ty, tm - 1, td))
  return `${start} – ${end} ${ty}`
}

export function formatMonth(value: LocalDate, locale = 'ru-RU'): string {
  const [year, month] = parts(value)
  const label = new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(year, month - 1, 1))
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${year}`
}

// 0=Sunday..6=Saturday, matching Date.getUTCDay.
export function weekdayIndex(value: LocalDate): number {
  const [year, month, day] = parts(value)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function dayOfMonth(value: LocalDate): number {
  return parts(value)[2]
}

const WEEKDAY_SHORT = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ']

export function weekdayShort(value: LocalDate): string {
  return WEEKDAY_SHORT[weekdayIndex(value)] ?? ''
}
