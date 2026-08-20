import { describe, expect, it } from 'vitest'
import type { CustomMetric, ProgressEntry } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { measurementSummaryItems, measurementSummaryText } from './measurement-summary'

const metric: CustomMetric = {
  id: 'metric-1', clientId: 'client-1', name: 'Процент жира', unit: '%', archivedAt: null, version: 1,
}

const entry: ProgressEntry = {
  id: 'progress-1', clientId: 'client-1', createdBy: 'trainer-1', recordedOn: localDate('2026-08-20'),
  weightKg: 79.34, chestCm: 101.66, waistCm: 82, hipCm: 98, customMetrics: [{ metricId: metric.id, value: 17.56 }], version: 1,
}

describe('measurement summary', () => {
  it('делит подписи и значения для компактного последнего замера', () => {
    expect(measurementSummaryItems(entry, [metric])).toEqual([
      { label: 'Вес', value: '79,3 кг' },
      { label: 'Грудь', value: '101,7 см' },
      { label: 'Талия', value: '82 см' },
      { label: 'Бёдра', value: '98 см' },
      { label: 'Процент жира', value: '17,6 %' },
    ])
  })

  it('ограничивает длинную строку истории и показывает остаток', () => {
    expect(measurementSummaryText(entry, [metric])).toBe('вес 79,3 кг · грудь 101,7 см · талия 82 см · бёдра 98 см · ещё 1')
  })
})
