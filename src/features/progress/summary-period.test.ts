import { describe, expect, it } from 'vitest'
import { localDate } from '../../shared/local-date'
import { summaryPeriodMatch, summaryPeriodRange } from './summary-period'

describe('summary period helpers', () => {
  it('builds the inclusive analysis range', () => {
    expect(summaryPeriodRange('1m', localDate('2026-08-16'))).toEqual({
      start: localDate('2026-07-17'),
      end: localDate('2026-08-16'),
    })
  })

  it('matches by window length and prefers the most recent equal match', () => {
    const older = { periodStart: localDate('2026-02-15'), periodEnd: localDate('2026-08-14'), id: 'older' }
    const current = { periodStart: localDate('2026-02-17'), periodEnd: localDate('2026-08-16'), id: 'current' }
    expect(summaryPeriodMatch([older, current], '6m', localDate('2026-08-16'))).toBe(current)
    expect(summaryPeriodMatch([current], '1m', localDate('2026-08-16'))).toBeUndefined()
  })
})
