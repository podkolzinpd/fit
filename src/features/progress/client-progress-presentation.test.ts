import { describe, expect, it } from 'vitest'
import type { PublishedTrainingSummary, TrainingProgressFact } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { clientProgressPresentation } from './client-progress-presentation'

function summary(progressFacts: TrainingProgressFact[], overrides: Partial<PublishedTrainingSummary['summary']> = {}): PublishedTrainingSummary {
  return {
    id: 'published-1',
    sourceSummaryId: 'summary-1',
    clientId: 'client-1',
    periodStart: localDate('2026-07-24'),
    periodEnd: localDate('2026-08-24'),
    summary: {
      headline: 'Есть заметный прогресс в упражнениях.',
      achievements: [],
      consistency: 'Тренировки проходили регулярно.',
      encouragement: 'Ты заметно прибавил в силе. Сейчас важнее сохранить ритм, чем резко увеличивать объём.',
      nextSteps: ['Продолжать отслеживать результаты.'],
      ...overrides,
    },
    metrics: {
      completedWorkouts: 9,
      workoutsPerWeek: 2.9,
      activeWeeks: 4,
      longestGapDays: 5,
      progressFacts,
    },
    generatedAt: '2026-08-24T18:00:00Z',
    publishedAt: '2026-08-24T18:05:00Z',
  }
}

describe('clientProgressPresentation', () => {
  it('puts the strongest confirmed result first and keeps exact values', () => {
    const result = clientProgressPresentation(summary([{
      exerciseName: 'Жим гантелей лёжа (Гантели)', kind: 'strength', sessionCount: 4,
      changes: [{ metric: 'volume', from: 2100, to: 2940, changePercent: 40, favorable: true }],
    }, {
      exerciseName: 'Тяга верхнего блока (Блок)', kind: 'strength', sessionCount: 3,
      changes: [{ metric: 'max_weight', from: 50, to: 68, changePercent: 36, favorable: true }],
    }]))

    expect(result.hero).toEqual({
      eyebrow: 'Лучший результат периода',
      value: '+40%',
      title: 'Жим гантелей лёжа (Гантели)',
      detail: 'Объём за тренировку: 2 100 → 2 940 кг',
    })
    expect(result.stats).toEqual([
      { value: '9', label: 'тренировок' },
      { value: '4', label: 'недели с тренировками' },
      { value: '2', label: 'упражнения улучшены' },
    ])
    expect(result.wins[0]).toEqual({
      title: 'Тяга верхнего блока (Блок)',
      detail: '+36% · Рабочий вес: 50 → 68 кг',
    })
  })

  it('replaces a generic recommendation with one concrete next step', () => {
    const result = clientProgressPresentation(summary([{
      exerciseName: 'Тяга верхнего блока (Блок)', kind: 'strength', sessionCount: 3,
      changes: [{ metric: 'max_weight', from: 50, to: 68, changePercent: 36, favorable: true }],
    }]))

    expect(result.nextStep).toBe('Закрепи 68 кг в упражнении «Тяга верхнего блока (Блок)» на следующей тренировке.')
    expect(result.insight).toBe('Ты заметно прибавил в силе. Сейчас важнее сохранить ритм, чем резко увеличивать объём.')
  })

  it('shows a supportive starting point before comparable progress exists', () => {
    const input = summary([])
    input.metrics.completedWorkouts = 1
    input.metrics.activeWeeks = 1

    const result = clientProgressPresentation(input)

    expect(result.hero.title).toBe('Первая тренировка сохранена')
    expect(result.hero.detail).toBe('После следующего результата покажем первые изменения.')
    expect(result.stats).toEqual([
      { value: '1', label: 'тренировка' },
      { value: '1', label: 'неделя с тренировками' },
    ])
  })

  it('describes faster running pace without presenting it as growth', () => {
    const result = clientProgressPresentation(summary([{
      exerciseName: 'Бег', kind: 'distance', sessionCount: 3,
      changes: [{ metric: 'pace', from: 6, to: 5.5, changePercent: 8, favorable: true }],
    }]))

    expect(result.hero.value).toBe('8% быстрее')
    expect(result.hero.detail).toBe('Темп: 6:00 → 5:30 мин/км')
  })
})
