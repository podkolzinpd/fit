import { describe, expect, it } from 'vitest'
import { formatLocalDate, localDate, todayLocalDate } from './local-date'

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
