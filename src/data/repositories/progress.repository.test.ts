import { describe, expect, it } from 'vitest'
import type { ProgressEntry } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { findProgressDateConflict, groupCustomMetricValues, roundMetric } from './progress-rules'

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

describe('groupCustomMetricValues', () => {
  it('группирует значения одним проходом по progress_id', () => {
    expect(groupCustomMetricValues([
      { progress_id: 'p1', metric_id: 'm1', value: 10 },
      { progress_id: 'p2', metric_id: 'm2', value: 20 },
      { progress_id: 'p1', metric_id: 'm3', value: 30 },
    ])).toEqual(new Map([
      ['p1', [{ metricId: 'm1', value: 10 }, { metricId: 'm3', value: 30 }]],
      ['p2', [{ metricId: 'm2', value: 20 }]],
    ]))
  })

  it('возвращает пустую карту без значений', () => {
    expect(groupCustomMetricValues([])).toEqual(new Map())
  })
})
