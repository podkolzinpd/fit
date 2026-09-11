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
  it('shows the current analysis as one complete trainer breakdown and a conclusion', () => {
    const sections = buildProgressDetailedAnalysis({
      summary: {
        ...publishedSummary,
        summary: {
          headline: 'Специализация на плечах даёт измеримый результат, а общий объём остаётся управляемым.',
          achievements: [
            'Плечи: жим сидя вырос с 10 до 14 повторений при том же весе 60 кг.',
            'Ноги: жим ногами вырос со 140 до 160 кг без снижения повторений.',
          ],
          consistency: 'Выполнено 6 тренировок за 4 недели, ритм достаточно ровный для сравнения.',
          encouragement: 'Текущая программа работает; важнее закрепить новые показатели, чем добавлять упражнения.',
          goalAlignment: 'Рост результатов в упражнениях на плечи согласуется с целью увеличить плечи, но одного периода мало для вывода о росте мышц.',
          nextSteps: [
            'Сохранить основные упражнения ещё на 4 недели и прогрессировать повторениями.',
            'Повторить замеры плеч и талии через 4 недели в тех же условиях.',
          ],
          missingContext: [],
          analysisVersion: 'trainer-summary-v3',
        },
      },
      role: 'client',
      goalTitle: 'Увеличить плечи',
      visibleTexts: ['Жим сидя: 60 кг'],
    })

    expect(sections.map((section) => section.title)).toEqual(['Разбор периода', 'Итог'])
    expect(sections[0]?.items).toEqual([
      'Стабильность: Выполнено 6 тренировок за 4 недели, ритм достаточно ровный для сравнения.',
      'Цель: Рост результатов в упражнениях на плечи согласуется с целью увеличить плечи, но одного периода мало для вывода о росте мышц.',
      'Плечи: жим сидя вырос с 10 до 14 повторений при том же весе 60 кг.',
      'Ноги: жим ногами вырос со 140 до 160 кг без снижения повторений.',
      'Дальше: Сохранить основные упражнения ещё на 4 недели и прогрессировать повторениями.',
      'Следующий контроль: Повторить замеры плеч и талии через 4 недели в тех же условиях.',
    ])
    expect(sections[1]?.items).toEqual([
      'Текущая программа работает; важнее закрепить новые показатели, чем добавлять упражнения.',
    ])
  })

  it('shows the whole-period analysis as four decision-oriented answers', () => {
    const sections = buildProgressDetailedAnalysis({
      summary: {
        ...publishedSummary,
        summary: {
          headline: 'Рост нагрузки пока подтверждён отдельными сильными тренировками, а не устойчивой серией.',
          achievements: ['Вес в тяге вырос с 50 до 68 кг без сокращения числа подходов.'],
          consistency: 'За период выполнено 6 тренировок.',
          encouragement: 'Сильные точки уже есть, теперь важна их повторяемость.',
          goalAlignment: 'До цели 70 кг остался один небольшой шаг, но результат ещё стоит закрепить.',
          nextSteps: ['На следующей тяге повторить 68 кг с тем же числом подходов.'],
          missingContext: ['Не хватает оценки тяжести последней тренировки.'],
          analysisVersion: 'whole-period-v1',
        },
      },
      role: 'client',
      goalTitle: 'Увеличить рабочий вес в тяге до 70 кг',
      visibleTexts: [],
    })

    expect(sections.map((section) => section.title)).toEqual([
      'Движение к цели',
      'Что заметил ИИ',
      'Что делать дальше',
      'Чего не хватает',
    ])
    expect(sections[0]?.items[0]).toContain('До цели 70 кг')
    expect(sections[1]?.items).toHaveLength(2)
    expect(sections[2]?.items).toEqual(['На следующей тяге повторить 68 кг с тем же числом подходов.'])
    expect(sections[3]?.items).toEqual(['Не хватает оценки тяжести последней тренировки.'])
  })

  it('builds the coaching story from safe, grounded LLM copy', () => {
    const sections = buildProgressDetailedAnalysis({
      summary: publishedSummary,
      role: 'client',
      goalTitle: 'Увеличить рабочий вес в тяге до 70 кг',
      visibleTexts: [],
    })

    expect(sections.map((section) => section.title)).toEqual([
      'Главное сейчас',
      'Почему',
      'На следующей тренировке',
    ])
    expect(sections[0]?.items).toEqual(['Тяга верхнего блока: рабочий вес вырос с 50 до 68 кг.'])
    expect(sections[1]?.items).toEqual([
      'Рабочий вес приблизился к цели 70 кг.',
      'Тяга верхнего блока выполнена в 3 тренировках без длинных пауз.',
    ])
    expect(sections[2]?.items).toEqual([
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
    expect(sections[0]?.emptyMessage).toBe('Нового вывода сверх показанных результатов пока нет.')
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

    expect(sections[2]?.items).toEqual([])
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
    expect(sections[1]?.emptyMessage).toBe('Дополнительных подтверждений сверх карточек выше пока нет.')
  })

  it('accepts a body-measurement conclusion only when its numbers are grounded', () => {
    const measurementSummary: PublishedTrainingSummary = {
      ...publishedSummary,
      summary: {
        ...publishedSummary.summary,
        headline: 'Талия уменьшилась с 91 до 88 см за период.',
      },
    }

    const grounded = buildProgressDetailedAnalysis({
      summary: measurementSummary,
      role: 'client',
      goalTitle: 'Снизить объём талии',
      visibleTexts: ['91', '88'],
    })
    const invented = buildProgressDetailedAnalysis({
      summary: measurementSummary,
      role: 'client',
      goalTitle: 'Снизить объём талии',
      visibleTexts: ['91'],
    })

    expect(grounded[0]?.items).toEqual(['Талия уменьшилась с 91 до 88 см за период.'])
    expect(invented[0]?.items).toEqual([])
  })
})
