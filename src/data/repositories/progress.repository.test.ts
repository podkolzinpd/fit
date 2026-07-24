import { describe, expect, it } from 'vitest'
import { groupCustomMetricValues, roundMetric } from './progress-rules'

describe('roundMetric', () => {
  it('округляет до точности БД', () => expect(roundMetric(1.23456)).toBe(1.235))
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
