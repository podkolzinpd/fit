import { describe, expect, it } from 'vitest'
import {
  addDays, addMonths, DEFAULT_TIME_ZONE, endOfMonth, endOfWeek, formatLocalDate, formatLocalDateShort,
  formatMonth, isValidTimeZone, localDate, normalizeTimeZone, startOfMonth, startOfWeek, todayInTimeZone,
} from './local-date'

describe('LocalDate', () => {
  it('не сдвигает календарный день через UTC', () => {
    expect(todayInTimeZone('Europe/Moscow', new Date('2026-07-20T21:05:00.000Z'))).toBe('2026-07-21')
  })

  it('берёт границу дня из профиля, а не timezone устройства', () => {
    const now = new Date('2026-08-14T22:30:00.000Z')
    expect(todayInTimeZone('Europe/Berlin', now)).toBe('2026-08-15')
    expect(todayInTimeZone('America/New_York', now)).toBe('2026-08-14')
  })

  it('корректно переживает оба перехода DST', () => {
    expect(todayInTimeZone('Europe/Berlin', new Date('2026-03-29T00:30:00.000Z'))).toBe('2026-03-29')
    expect(todayInTimeZone('Europe/Berlin', new Date('2026-03-29T22:30:00.000Z'))).toBe('2026-03-30')
    expect(todayInTimeZone('Europe/Berlin', new Date('2026-10-25T00:30:00.000Z'))).toBe('2026-10-25')
    expect(todayInTimeZone('Europe/Berlin', new Date('2026-10-25T23:30:00.000Z'))).toBe('2026-10-26')
  })

  it('предсказуемо нормализует timezone старого профиля', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true)
    expect(isValidTimeZone('Berlin')).toBe(false)
    expect(normalizeTimeZone('Berlin')).toBe(DEFAULT_TIME_ZONE)
  })

  it('отклоняет невозможную дату', () => {
    expect(() => localDate('2026-02-30')).toThrow('Некорректная')
  })

  it('форматирует локально', () => {
    expect(formatLocalDate(localDate('2026-07-21'))).toContain('2026')
  })

  it('форматирует кратко в числовом виде', () => {
    expect(formatLocalDateShort(localDate('2026-07-05'))).toBe('05.07.2026')
  })
})

describe('date arithmetic', () => {
  it('addDays переходит через границу месяца и года', () => {
    expect(addDays(localDate('2026-07-30'), 5)).toBe('2026-08-04')
    expect(addDays(localDate('2026-12-31'), 1)).toBe('2027-01-01')
    expect(addDays(localDate('2026-03-01'), -1)).toBe('2026-02-28')
  })

  it('addMonths зажимает день до конца месяца', () => {
    expect(addMonths(localDate('2026-01-31'), 1)).toBe('2026-02-28')
    expect(addMonths(localDate('2026-07-15'), -1)).toBe('2026-06-15')
    expect(addMonths(localDate('2026-12-15'), 1)).toBe('2027-01-15')
  })

  it('startOfWeek/endOfWeek — неделя с воскресенья', () => {
    // 2026-07-22 — среда, неделя ВС 19 .. СБ 25
    expect(startOfWeek(localDate('2026-07-22'))).toBe('2026-07-19')
    expect(endOfWeek(localDate('2026-07-22'))).toBe('2026-07-25')
    // воскресенье — начало своей недели
    expect(startOfWeek(localDate('2026-07-19'))).toBe('2026-07-19')
  })

  it('startOfMonth/endOfMonth', () => {
    expect(startOfMonth(localDate('2026-07-22'))).toBe('2026-07-01')
    expect(endOfMonth(localDate('2026-07-22'))).toBe('2026-07-31')
    expect(endOfMonth(localDate('2026-02-10'))).toBe('2026-02-28')
  })

  it('formatMonth с заглавной буквы', () => {
    expect(formatMonth(localDate('2026-07-01'))).toMatch(/^Июль 2026/)
  })
})
