import { describe, expect, it } from 'vitest'
import type { ProgressEntry } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { findProgressDateConflict, roundMetric } from './progress-rules'

describe('roundMetric', () => {
  it('округляет до точности БД', () => expect(roundMetric(1.23456)).toBe(1.235))
})

describe('findProgressDateConflict', () => {
  const entries: ProgressEntry[] = [{
    id: 'progress-1',
    clientId: 'client-1',
    createdBy: 'trainer-1',
    recordedOn: localDate('2026-07-26'),
    weightKg: 80,
    customMetrics: [],
    version: 1,
  }]

  it('находит существующий замер на выбранную дату', () => {
    expect(findProgressDateConflict(entries, localDate('2026-07-26'))).toBe(entries[0])
  })

  it('разрешает сохранять редактируемый замер на его дату', () => {
    expect(findProgressDateConflict(entries, localDate('2026-07-26'), 'progress-1')).toBeUndefined()
  })

  it('разрешает новую дату', () => {
    expect(findProgressDateConflict(entries, localDate('2026-07-27'))).toBeUndefined()
  })
})
