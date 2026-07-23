import { describe, expect, it } from 'vitest'
import {
  addDays, addMonths, endOfMonth, endOfWeek, formatLocalDate, formatMonth,
  localDate, startOfMonth, startOfWeek, todayLocalDate,
} from './local-date'

describe('LocalDate', () => {
  it('не сдвигает календарный день через UTC', () => {
    expect(todayLocalDate(new Date(2026, 6, 21, 0, 5))).toBe('2026-07-21')
  })

  it('отклоняет невозможную дату', () => {
    expect(() => localDate('2026-02-30')).toThrow('Некорректная')
  })

  it('форматирует локально', () => {
    expect(formatLocalDate(localDate('2026-07-21'))).toContain('2026')
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

  it('startOfWeek/endOfWeek — неделя с понедельника', () => {
    // 2026-07-22 — среда
    expect(startOfWeek(localDate('2026-07-22'))).toBe('2026-07-20')
    expect(endOfWeek(localDate('2026-07-22'))).toBe('2026-07-26')
    // воскресенье относится к своей неделе, а не к следующей
    expect(startOfWeek(localDate('2026-07-26'))).toBe('2026-07-20')
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
