import { describe, expect, it } from 'vitest'
import type { ClientGoal, CustomMetric, ProgressEntry } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { buildMeasurementProgress, formatMeasurementDelta, measurementSufficiencyLabel } from './measurement-progress'

const entries: ProgressEntry[] = [
  { id: 'm1', clientId: 'c1', createdBy: 'c1', recordedOn: localDate('2026-07-10'), weightKg: 80, waistCm: 84, customMetrics: [{ metricId: 'shoulders', value: 112 }], version: 1 },
  { id: 'm2', clientId: 'c1', createdBy: 'c1', recordedOn: localDate('2026-08-01'), weightKg: 80.5, waistCm: 83, customMetrics: [{ metricId: 'shoulders', value: 113 }], version: 1 },
  { id: 'm3', clientId: 'c1', createdBy: 'c1', recordedOn: localDate('2026-08-12'), weightKg: 81.5, waistCm: 81, customMetrics: [{ metricId: 'shoulders', value: 114 }], version: 1 },
  { id: 'm4', clientId: 'c1', createdBy: 'c1', recordedOn: localDate('2026-08-20'), weightKg: 81, waistCm: 82, customMetrics: [{ metricId: 'shoulders', value: 115 }], version: 1 },
  { id: 'm5', clientId: 'c1', createdBy: 'c1', recordedOn: localDate('2026-08-28'), weightKg: 82, waistCm: 81.5, customMetrics: [{ metricId: 'shoulders', value: 116 }], version: 1 },
]

const metrics: CustomMetric[] = [{ id: 'shoulders', clientId: 'c1', name: 'Плечи', unit: 'см', archivedAt: null, version: 1 }]

function goal(metric: 'weight' | 'custom'): ClientGoal {
  return {
    id: 'g1', clientId: 'c1', title: 'Цель', targetDate: null, status: 'active', version: 1, stages: [],
    criteria: [{
      id: 'criterion', goalId: 'g1', metric, operation: 'increase_to', targetValue: metric === 'weight' ? 85 : 118,
      rangeMin: null, rangeMax: null, unit: metric === 'weight' ? 'кг' : 'см', baselineValue: null,
      baselineRecordedOn: null, customMetricId: metric === 'custom' ? 'shoulders' : null,
      customMetricName: metric === 'custom' ? 'Плечи' : null, confirmationStatus: 'confirmed', position: 0, version: 1,
    }],
  }
}

describe('measurement progress', () => {
  it('calculates period boundaries, delta, min/max, freshness and latest value separately', () => {
    const result = buildMeasurementProgress({
      entries, customMetrics: metrics, goal: goal('weight'),
      periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-20'), today: localDate('2026-08-30'),
    })
    expect(result.primary).toMatchObject({
      label: 'Вес', goalRelated: true, count: 3, delta: 0.5, trend: 'fluctuation',
      freshness: 'fresh', ageDays: 2, sufficiency: 'enough_for_dynamics', hasNewerValueAfterPeriod: true,
      latest: { value: 82, date: '2026-08-28' }, periodStart: { value: 80.5 }, periodEnd: { value: 81 },
      min: { value: 80.5 }, max: { value: 81.5 }, targetLabel: 'увеличить до 85 кг',
      goalGuide: { min: 85, max: 85, label: 'Цель · 85 кг' },
    })
    expect(result.explanation?.text).toContain('80,5–81,5 кг')
  })

  it('prioritizes a goal-related custom metric over a larger unrelated change', () => {
    const result = buildMeasurementProgress({
      entries, customMetrics: metrics, goal: goal('custom'),
      periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-20'), today: localDate('2026-08-30'),
    })
    expect(result.primary?.label).toBe('Плечи')
    expect(result.primary?.selector).toEqual({ customMetricId: 'shoulders' })
    expect(result.primary?.targetLabel).toBe('увеличить до 118 см')
  })

  it('builds an honest chart range for a maintain goal', () => {
    const rangeGoal = goal('weight')
    rangeGoal.criteria[0] = {
      ...rangeGoal.criteria[0]!, operation: 'maintain_range', targetValue: null, rangeMin: 79.5, rangeMax: 80.5,
    }
    const result = buildMeasurementProgress({
      entries, customMetrics: metrics, goal: rangeGoal,
      periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-20'), today: localDate('2026-08-30'),
    })
    expect(result.primary?.goalGuide).toEqual({ min: 79.5, max: 80.5, label: 'Цель · 79,5–80,5 кг' })
  })

  it('derives an absolute chart target for change-by only from a confirmed baseline', () => {
    const changeGoal = goal('weight')
    changeGoal.criteria[0] = {
      ...changeGoal.criteria[0]!, operation: 'change_by', targetValue: -3, baselineValue: 82,
    }
    const result = buildMeasurementProgress({
      entries, customMetrics: metrics, goal: changeGoal,
      periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-20'), today: localDate('2026-08-30'),
    })
    expect(result.primary?.goalGuide).toEqual({ min: 79, max: 79, label: 'Цель · 79 кг' })

    changeGoal.criteria[0] = { ...changeGoal.criteria[0]!, baselineValue: null }
    expect(buildMeasurementProgress({
      entries, customMetrics: metrics, goal: changeGoal,
      periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-20'), today: localDate('2026-08-30'),
    }).primary?.goalGuide).toBeNull()
  })

  it('marks one point as insufficient and stale using the named policy', () => {
    const result = buildMeasurementProgress({
      entries: [entries[0]!], customMetrics: metrics, goal: null,
      periodStart: localDate('2026-07-01'), periodEnd: localDate('2026-07-31'), today: localDate('2026-08-30'),
    })
    expect(result.primary).toMatchObject({ freshness: 'stale', sufficiency: 'position_only', trend: 'insufficient_data' })
    expect(result.explanation?.text).toContain('одна точка')
  })

  it('distinguishes a current value outside the selected period from a point inside it', () => {
    const result = buildMeasurementProgress({
      entries: [entries[0]!], customMetrics: metrics, goal: goal('weight'),
      periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-20'), today: localDate('2026-08-30'),
    })
    expect(result.primary).toMatchObject({ count: 0, periodStart: null, periodEnd: null, sufficiency: 'position_only' })
    expect(result.explanation?.text).toBe('По показателю «Вес» нет точек за выбранный период; последнее значение — 80 кг.')
  })

  it('accepts only a short grounded LLM explanation with the metric and numeric anchors', () => {
    const accepted = buildMeasurementProgress({
      entries, customMetrics: metrics, goal: goal('weight'),
      periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-20'), today: localDate('2026-08-30'),
      llmCandidates: ['Вес колебался между 80,5 и 81,5 кг, завершив период на 81 кг.'],
    })
    expect(accepted.explanation).toMatchObject({ source: 'llm', text: 'Вес колебался между 80,5 и 81,5 кг, завершив период на 81 кг.' })

    const rejected = buildMeasurementProgress({
      entries, customMetrics: metrics, goal: goal('weight'),
      periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-20'), today: localDate('2026-08-30'),
      llmCandidates: ['Вес вырос из-за правильной программы, поэтому нужно увеличить нагрузку.'],
    })
    expect(rejected.explanation?.source).toBe('deterministic')
  })

  it('keeps an empty state without inventing a default measurement', () => {
    expect(buildMeasurementProgress({
      entries: [], customMetrics: [], goal: null,
      periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-20'), today: localDate('2026-08-30'),
    })).toEqual({ metrics: [], primary: null, explanation: null })
  })

  it('formats signed deltas without exposing a negative zero', () => {
    expect(formatMeasurementDelta(1.5, 'кг')).toBe('+1,5 кг')
    expect(formatMeasurementDelta(-1.5, 'кг')).toBe('−1,5 кг')
    expect(formatMeasurementDelta(0, 'кг')).toBe('0 кг')
  })

  it('uses the correct Russian plural form for a sufficient point count', () => {
    const metric = buildMeasurementProgress({
      entries, customMetrics: metrics, goal: null,
      periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-20'), today: localDate('2026-08-30'),
    }).primary!
    expect(measurementSufficiencyLabel({ ...metric, count: 2 })).toBe('2 точки · достаточно для динамики')
    expect(measurementSufficiencyLabel({ ...metric, count: 5 })).toBe('5 точек · достаточно для динамики')
    expect(measurementSufficiencyLabel({ ...metric, count: 11 })).toBe('11 точек · достаточно для динамики')
  })
})
