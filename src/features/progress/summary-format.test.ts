import { describe, expect, it } from 'vitest'
import { formatSummaryText, formatWorkoutsPerWeek, progressMetricNoun } from './summary-format'

describe('progress summary number formatting', () => {
  it('shows percentages as whole numbers', () => {
    expect(formatSummaryText('Вес вырос на 16,67%, объём — на 2.86%.'))
      .toBe('Вес вырос на 17%, объём — на 3%.')
  })

  it('shows weekly rates with at most one decimal place', () => {
    expect(formatSummaryText('Средняя частота — 1,13 в неделю и 0.08 / нед.'))
      .toBe('Средняя частота — 1,1 в неделю и 0,1 в неделю')
    expect(formatWorkoutsPerWeek(1.13)).toBe('1,1')
    expect(formatWorkoutsPerWeek(2)).toBe('2')
  })

  it('turns legacy technical metrics into readable Russian text', () => {
    expect(formatSummaryText(
      'Проверить: longest_gap_days составляет 5 дней, workouts_per_week составляет 0.23 и active_weeks — 3.',
    )).toBe(
      'Проверить: максимальный перерыв — 5 дней, частота — 0,2 тренировки в неделю и активных недель — 3.',
    )
  })

  it('never leaves an unknown snake_case identifier visible', () => {
    expect(formatSummaryText('Служебный custom_metric_key равен 1.25.'))
      .toBe('Служебный показатель равен 1,3.')
    expect(formatSummaryText('Период начался 16.08.2026.'))
      .toBe('Период начался 16.08.2026.')
  })

  it('uses natural Russian forms for progress counters', () => {
    expect(progressMetricNoun(1, 'workout')).toBe('тренировка')
    expect(progressMetricNoun(2, 'workout')).toBe('тренировки')
    expect(progressMetricNoun(5, 'workout')).toBe('тренировок')
    expect(progressMetricNoun(4, 'activeWeek')).toBe('активные недели')
    expect(progressMetricNoun(21, 'gapDay')).toBe('день без тренировок')
  })
})
