import { describe, expect, it, vi } from 'vitest'
import type { ProgressEntry } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { findProgressDateConflict, groupCustomMetricValues, roundMetric } from './progress-rules'

const queries = vi.hoisted(() => ({ regularity: vi.fn() }))
vi.mock('../queries/progress.queries', () => ({ progressQueries: queries }))

import { progressRepository } from './progress.repository'

describe('progressRepository.regularity', () => {
  it('maps the server aggregate without recalculating it in the browser', async () => {
    queries.regularity.mockResolvedValue({ data: [{
      period: 'week', period_start: '2026-08-10', period_end: '2026-08-16',
      planned_count: 4, completed_count: 3, completed_planned_count: 2,
      partial_count: 1, skipped_count: 1, completion_percent: 50,
    }, {
      period: 'month', period_start: '2026-08-01', period_end: '2026-08-31',
      planned_count: 0, completed_count: 1, completed_planned_count: 0,
      partial_count: 0, skipped_count: 0, completion_percent: null,
    }], error: null })

    await expect(progressRepository.regularity('client-1')).resolves.toEqual([{
      period: 'week', periodStart: '2026-08-10', periodEnd: '2026-08-16',
      plannedCount: 4, completedCount: 3, completedPlannedCount: 2,
      partialCount: 1, skippedCount: 1, completionPercent: 50,
    }, {
      period: 'month', periodStart: '2026-08-01', periodEnd: '2026-08-31',
      plannedCount: 0, completedCount: 1, completedPlannedCount: 0,
      partialCount: 0, skippedCount: 0, completionPercent: null,
    }])
    expect(queries.regularity).toHaveBeenCalledWith('client-1')
  })
})

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
