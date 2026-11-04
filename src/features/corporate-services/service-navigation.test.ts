import { describe, expect, it } from 'vitest'
import { historyRange, savedRange } from './service-navigation'
import { servicePeriod } from './service-time'

describe('service history navigation', () => {
  it('rejects impossible, reversed and overlong external ranges', () => {
    for (const query of ['from=2026-02-30&until=2026-03-01', 'from=2026-02-02&until=2026-02-01', 'from=2026-01-01&until=2026-12-01', 'from=https://example.com']) {
      expect(historyRange(new URLSearchParams(query), 'Europe/Moscow')).toEqual(servicePeriod('Europe/Moscow', 'month'))
    }
    expect(historyRange(new URLSearchParams('from=2026-01-01&until=2026-01-02'), 'Europe/Moscow')).toEqual({ from: '2026-01-01', until: '2026-01-02' })
  })
  it('uses the account date when revealing an old fact and retains a containing range', () => {
    const range = { from: '2026-11-01', until: '2026-11-05' }
    expect(savedRange(range, '2026-10-25T22:30:00Z', 'Europe/Moscow')).toEqual({ from: '2026-10-26', until: '2026-10-27' })
    expect(savedRange(range, '2026-11-01T22:30:00Z', 'Europe/Moscow')).toEqual(range)
  })
})
