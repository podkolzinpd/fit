import { describe, expect, it } from 'vitest'
import type { PublishedTrainingSummary, TrainingSummary } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { buildProgressDetailedAnalysis } from './progress-detailed-analysis'

const publishedSummary: PublishedTrainingSummary = {
  id: 'published-1',
  sourceSummaryId: 'summary-1',
  clientId: 'client-1',
  periodStart: localDate('2026-08-01'),
  periodEnd: localDate('2026-08-31'),
  summary: {
    headline: 'Тяга верхнего блока: рабочий вес вырос с 50 до 68 кг.',
    achievements: ['Риск требует внимания тренера.'],
    consistency: 'Тяга верхнего блока выполнена в 3 тренировках без длинных пауз.',
    encouragement: 'Хорошая работа.',
    goalAlignment: 'Рабочий вес приблизился к цели 70 кг.',
    nextSteps: ['Продолжать отслеживать результат.', 'Самая длинная пауза между тренировками составила 5 дней.'],
  },
  metrics: {
    completedWorkouts: 6,
    workoutsPerWeek: 1.5,
    activeWeeks: 4,
    longestGapDays: 5,
    progressFacts: [{
      exerciseName: 'Тяга верхнего блока',
      kind: 'strength',
      sessionCount: 3,
      changes: [{ metric: 'max_weight', from: 50, to: 68, changePercent: 36, favorable: true }],
    }],
  },
  generatedAt: '2026-08-31T08:00:00Z',
  publishedAt: '2026-08-31T08:05:00Z',
}

describe('buildProgressDetailedAnalysis', () => {
  it('builds the three client sections from safe, grounded LLM copy', () => {
    const sections = buildProgressDetailedAnalysis({
      summary: publishedSummary,
      role: 'client',
      goalTitle: 'Увеличить рабочий вес в тяге до 70 кг',
      visibleTexts: [],
    })

    expect(sections.map((section) => section.title)).toEqual([
      'Результат периода',
      'Связь с целью',
      'На что обратить внимание',
    ])
    expect(sections[0]?.items).toEqual(['Тяга верхнего блока: рабочий вес вырос с 50 до 68 кг.'])
    expect(sections[1]?.items).toEqual(['Рабочий вес приблизился к цели 70 кг.'])
    expect(sections[2]?.items).toEqual([
      'Тяга верхнего блока выполнена в 3 тренировках без длинных пауз.',
      'Самая длинная пауза между тренировками составила 5 дней.',
    ])
    expect(sections.flatMap((section) => section.items).join(' ')).not.toMatch(/тренер|риск/iu)
  })

  it('removes facts already visible above and explains the empty result', () => {
    const sections = buildProgressDetailedAnalysis({
      summary: publishedSummary,
      role: 'client',
      goalTitle: 'Увеличить рабочий вес в тяге до 70 кг',
      visibleTexts: [
        'Тяга верхнего блока: рабочий вес вырос с 50 до 68 кг.',
        'Рабочий вес приблизился к цели 70 кг.',
        'Выполнено 3 тренировки в тяге верхнего блока без длинных пауз.',
        'Самая длинная пауза между тренировками составила 5 дней.',
      ],
    })

    expect(sections.every((section) => section.items.length === 0)).toBe(true)
    expect(sections[0]?.emptyMessage).toBe('Все подтверждённые результаты уже показаны в карточках выше.')
  })

  it('removes a semantic repeat without requiring the exact same wording', () => {
    const sections = buildProgressDetailedAnalysis({
      summary: {
        ...publishedSummary,
        summary: {
          ...publishedSummary.summary,
          nextSteps: ['Продолжить текущий тренировочный ритм.'],
        },
      },
      role: 'client',
      goalTitle: null,
      visibleTexts: ['Продолжать текущий ритм тренировок.'],
    })

    expect(sections[2]?.items).toEqual([
      'Тяга верхнего блока выполнена в 3 тренировках без длинных пауз.',
    ])
  })

  it('does not duplicate private trainer attention in detailed analysis', () => {
    const trainerSummary: TrainingSummary = {
      id: 'summary-1', clientId: 'client-1', periodStart: publishedSummary.periodStart,
      periodEnd: publishedSummary.periodEnd, generatedAt: publishedSummary.generatedAt,
      version: 1, published: true, metrics: publishedSummary.metrics,
      client: publishedSummary.summary,
      trainer: {
        headline: 'Тяга верхнего блока: рабочий вес вырос с 50 до 68 кг.',
        progress: [],
        consistency: 'Тяга верхнего блока выполнена в 3 тренировках.',
        attention: ['Внутренний риск: проверить технику с клиентом.'],
      },
    }

    const sections = buildProgressDetailedAnalysis({
      summary: trainerSummary,
      role: 'trainer',
      goalTitle: null,
      visibleTexts: [],
    })

    expect(sections.flatMap((section) => section.items).join(' ')).not.toContain('Внутренний риск')
    expect(sections[1]?.emptyMessage).toBe('Цель не настроена, поэтому отдельная интерпретация не добавлена.')
  })
})
