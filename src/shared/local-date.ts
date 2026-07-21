declare const localDateBrand: unique symbol

export type LocalDate = string & { readonly [localDateBrand]: true }

const pattern = /^\d{4}-\d{2}-\d{2}$/

export function localDate(value: string): LocalDate {
  if (!pattern.test(value)) throw new Error('Дата должна иметь формат YYYY-MM-DD')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error('Некорректная календарная дата')
  }
  return value as LocalDate
}

export function todayLocalDate(now = new Date()): LocalDate {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return localDate(`${year}-${month}-${day}`)
}

export function formatLocalDate(value: LocalDate, locale = 'ru-RU'): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(year ?? 0, (month ?? 1) - 1, day))
}
