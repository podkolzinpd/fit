import { describe, expect, it } from 'vitest'
import type { ClientTrainingSummary } from '../../shared/domain'

import { publishedTrainingSummaryFromRow, trainingSummaryFromRow } from './training-summary-mappers'

const clientId = '1a0c5295-0a0f-4ccb-a39a-e58090967245'
const summaryId = '00b88f4f-e17a-47ae-9d2e-c68079217ac5'
const publishedId = 'e7335649-0713-44a7-9640-5453a3849dca'

const clientSummary: ClientTrainingSummary = {
  headline: 'Итог',
  achievements: ['Рост'],
  consistency: 'Стабильно',
  encouragement: 'Продолжайте',
  goalAlignment: 'По плану',
  nextSteps: ['Следующий шаг'],
}
const clientSummaryJson: Record<string, string | string[]> = {
  headline: 'Итог',
  achievements: ['Рост'],
  consistency: 'Стабильно',
  encouragement: 'Продолжайте',
  goalAlignment: 'По плану',
  nextSteps: ['Следующий шаг'],
}

function internalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: summaryId,
    client_id: clientId,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    trainer_summary: {
      headline: 'Итог тренера', progress: ['Рост'],
      consistency: 'Стабильно', attention: [],
    },
    client_summary: clientSummaryJson,
    display_metrics: {
      completed_workouts: 2,
      workouts_per_week: 1.5,
      active_weeks: 2,
      longest_gap_days: 3,
      progress_facts: [{
        exercise_name: 'Приседания', kind: 'strength', session_count: 2,
        changes: [{ metric: 'max_weight', from: 40, to: 45, change_percent: 12.5, favorable: true }],
      }],
    },
    generated_at: '2026-09-01T00:00:00.000Z',
    version: 2,
    ...overrides,
  }
}

function publishedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: publishedId,
    source_summary_id: summaryId,
    client_id: clientId,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    summary: clientSummaryJson,
    display_metrics: internalRow().display_metrics,
    generated_at: '2026-09-01T00:00:00.000Z',
    published_at: '2026-09-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('training summaries repository', () => {
  it('maps internal and published summaries including verified progress facts', () => {
    expect(trainingSummaryFromRow(internalRow(), true)).toMatchObject({
      id: summaryId,
      published: true,
      metrics: {
        completedWorkouts: 2,
        longestGapDays: 3,
        progressFacts: [{ exerciseName: 'Приседания', kind: 'strength' }],
      },
    })
    expect(trainingSummaryFromRow(internalRow(), false).published).toBe(false)
    expect(publishedTrainingSummaryFromRow(publishedRow())).toMatchObject({
      id: publishedId,
      sourceSummaryId: summaryId,
      summary: clientSummary,
    })
  })

  it('normalizes optional summary fields and ignores malformed progress facts', () => {
    const result = trainingSummaryFromRow(internalRow({
      client_summary: {
        headline: 'Итог', achievements: [], consistency: 'Редко', encouragement: 'Продолжайте',
        goalAlignment: '   ', nextSteps: 'не список',
      },
      display_metrics: {
        completed_workouts: 'нет', workouts_per_week: null, active_weeks: undefined,
        longest_gap_days: null,
        progress_facts: [null, [], {}, {
          exercise_name: 'Некорректно', kind: 'strength', session_count: 1,
          changes: [null, { metric: 'unknown', from: 1, to: 2, change_percent: 1, favorable: null }],
        }],
      },
    }), false)
    expect(result.client.goalAlignment).toBeUndefined()
    expect(result.client.nextSteps).toBeUndefined()
    expect(result.metrics).toEqual({
      completedWorkouts: 0,
      workoutsPerWeek: 0,
      activeWeeks: 0,
      longestGapDays: null,
      progressFacts: [],
    })
  })

  it.each([
    { trainer_summary: null },
    { trainer_summary: { headline: 1, progress: [], consistency: 'ok', attention: [] } },
    { trainer_summary: { headline: 'ok', progress: 'нет', consistency: 'ok', attention: [] } },
  ])('rejects an invalid stored summary %#', (overrides) => {
    expect(() => trainingSummaryFromRow(internalRow(overrides), false)).toThrow(/суммаризац/i)
  })








})
