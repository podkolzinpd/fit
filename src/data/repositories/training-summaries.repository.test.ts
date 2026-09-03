import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientTrainingSummary } from '../../shared/domain'

const queries = vi.hoisted(() => ({
  firstCompletedWorkoutDate: vi.fn(),
  listInternal: vi.fn(),
  listPublished: vi.fn(),
  generate: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
}))

vi.mock('../queries/training-summaries.queries', () => ({ trainingSummaryQueries: queries }))

import {
  publishedTrainingSummaryFromRow,
  trainingSummariesRepository,
  trainingSummaryFromRow,
} from './training-summaries.repository'

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
  beforeEach(() => {
    for (const query of Object.values(queries)) query.mockReset()
  })

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

  it('reads, generates, publishes and unpublishes summaries', async () => {
    queries.firstCompletedWorkoutDate.mockResolvedValue({ data: { workout_date: '2026-08-01' }, error: null })
    queries.listInternal.mockResolvedValue({ data: [internalRow()], error: null })
    queries.listPublished.mockResolvedValue({ data: [publishedRow()], error: null })
    queries.generate.mockResolvedValue({ data: { data: { generated_at: '2026-09-03T00:00:00.000Z' }, cached: true }, error: null })
    queries.publish.mockResolvedValue({ data: [{ version: 3 }], error: null })
    queries.unpublish.mockResolvedValue({ data: 3, error: null })

    expect(await trainingSummariesRepository.firstCompletedWorkoutDate(clientId)).toBe('2026-08-01')
    const summaries = await trainingSummariesRepository.listForTrainer(clientId)
    expect(summaries[0]?.published).toBe(true)
    expect(await trainingSummariesRepository.listForClient(clientId)).toHaveLength(1)
    expect(await trainingSummariesRepository.generate(clientId, '2026-08-01', '2026-08-31')).toEqual({
      generatedAt: '2026-09-03T00:00:00.000Z', cached: true,
    })
    await trainingSummariesRepository.publish(summaries[0]!, clientSummary)
    await trainingSummariesRepository.unpublish(summaries[0]!)
  })

  it('returns no first workout and a non-cached generated summary', async () => {
    queries.firstCompletedWorkoutDate.mockResolvedValue({ data: null, error: null })
    queries.generate.mockResolvedValue({ data: { data: { generated_at: '2026-09-03T00:00:00.000Z' } }, error: null })
    expect(await trainingSummariesRepository.firstCompletedWorkoutDate(clientId)).toBeNull()
    expect((await trainingSummariesRepository.generate(clientId, '2026-08-01', '2026-08-31', true)).cached).toBe(false)
  })

  it('does not swallow read or mutation failures and validates mutation results', async () => {
    const databaseError = { code: 'PT409', message: 'conflict' }
    queries.firstCompletedWorkoutDate.mockResolvedValue({ data: null, error: databaseError })
    await expect(trainingSummariesRepository.firstCompletedWorkoutDate(clientId)).rejects.toMatchObject({ code: 'PT409' })

    queries.listInternal.mockResolvedValue({ data: [], error: databaseError })
    queries.listPublished.mockResolvedValue({ data: [], error: null })
    await expect(trainingSummariesRepository.listForTrainer(clientId)).rejects.toMatchObject({ code: 'PT409' })
    queries.listInternal.mockResolvedValue({ data: [], error: null })
    queries.listPublished.mockResolvedValue({ data: [], error: databaseError })
    await expect(trainingSummariesRepository.listForTrainer(clientId)).rejects.toMatchObject({ code: 'PT409' })
    await expect(trainingSummariesRepository.listForClient(clientId)).rejects.toMatchObject({ code: 'PT409' })

    const summary = trainingSummaryFromRow(internalRow(), false)
    queries.publish.mockResolvedValue({ data: null, error: databaseError })
    await expect(trainingSummariesRepository.publish(summary, clientSummary)).rejects.toMatchObject({ code: 'PT409' })
    queries.publish.mockResolvedValue({ data: [], error: null })
    await expect(trainingSummariesRepository.publish(summary, clientSummary)).rejects.toThrow('не была опубликована')
    queries.unpublish.mockResolvedValue({ data: null, error: databaseError })
    await expect(trainingSummariesRepository.unpublish(summary)).rejects.toMatchObject({ code: 'PT409' })
    queries.unpublish.mockResolvedValue({ data: 2, error: null })
    await expect(trainingSummariesRepository.unpublish(summary)).rejects.toThrow('не была скрыта')
  })

  it('maps generation response and transport errors to actionable messages', async () => {
    const generate = (result: unknown) => {
      queries.generate.mockResolvedValueOnce(result)
      return trainingSummariesRepository.generate(clientId, '2026-08-01', '2026-08-31')
    }
    await expect(generate({ data: { error: 'no_completed_workouts' }, error: null })).rejects.toThrow('нет завершённых')
    await expect(generate({ data: {}, error: null })).rejects.toThrow('не подтвердил')
    await expect(generate({ data: null, error: { context: { name: 'AbortError' } } })).rejects.toThrow('слишком много времени')
    await expect(generate({ data: null, error: { context: { headers: { get: () => 'yandex_cloud_timeout' } } } })).rejects.toThrow('через минуту')
    await expect(generate({ data: null, error: { context: { headers: { get: () => null }, json: () => Promise.resolve({ code: 'no_completed_workouts' }) } } })).rejects.toThrow('нет завершённых')
    await expect(generate({ data: null, error: { context: { json: () => Promise.resolve({ error: 'source_row_limit_reached' }) } } })).rejects.toThrow('меньший период')
    await expect(generate({ data: null, error: { context: { json: () => Promise.resolve({ message: 'Ответ сервера' }) } } })).rejects.toThrow('Ответ сервера')
    await expect(generate({ data: null, error: { context: { json: () => Promise.reject(new Error('invalid json')) } } })).rejects.toMatchObject({ code: 'database_error' })
    await expect(generate({ data: null, error: { code: 'PT404', message: 'missing' } })).rejects.toMatchObject({ code: 'PT404' })
  })
})
