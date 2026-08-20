import { describe, expect, it } from 'vitest'
import { localDate } from '../../shared/local-date'
import { availableSummaryPeriods, summaryPeriodMatch, summaryPeriodRange } from './summary-period'

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

  it('reveals three months in the second month and six months after six months of history', () => {
    const today = localDate('2026-08-20')
    expect(availableSummaryPeriods(null, today)).toEqual(['1m'])
    expect(availableSummaryPeriods(localDate('2026-08-01'), today)).toEqual(['1m'])
    expect(availableSummaryPeriods(localDate('2026-07-20'), today)).toEqual(['1m', '3m'])
    expect(availableSummaryPeriods(localDate('2026-05-20'), today)).toEqual(['1m', '3m'])
    expect(availableSummaryPeriods(localDate('2026-02-20'), today)).toEqual(['1m', '3m', '6m'])
  })

  it('keeps six months hidden at the start of the sixth month', () => {
    const today = localDate('2026-08-20')
    expect(availableSummaryPeriods(localDate('2026-02-21'), today)).toEqual(['1m', '3m'])
  })
})
