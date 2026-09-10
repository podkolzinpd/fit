import { describe, expect, it } from 'vitest'
import { summaryQualityIssues } from '../../supabase/functions/summarize-client-training/summary-quality'

const trainingData = {
  consistency: {
    completed_workouts: 24,
    workouts_per_week: 0.9,
    longest_gap_days: 21,
  },
  exercises: [
    {
      name: 'Жим лёжа',
      session_count: 2,
      change_percent: { max_weight: 25 },
    },
    {
      name: 'Бег',
      session_count: 2,
      change_percent: { pace: -10 },
    },
  ],
}

describe('summaryQualityIssues', () => {
  it('accepts a safe dual-audience summary with Russian word forms', () => {
    const issues = summaryQualityIssues({
      trainer: {
        headline: 'В жиме лёжа вес вырос на 25%, в беге темп улучшился на 10%.',
        progress: [
          'В жиме лёжа рабочий вес вырос на 25%.',
          'В беге темп улучшился на 10%.',
        ],
        consistency: 'Выполнено 24 тренировки, перерыв — 21 день.',
        attention: ['Проверить: причина перерыва в 21 день.'],
      },
      client: {
        headline: 'Силовой прогресс сейчас заметнее изменений в беге.',
        achievements: [
          'Грудь: в жиме лёжа рабочий вес вырос на 25%.',
          'Кардио: в беге темп улучшился на 10%.',
        ],
        consistency: 'Выполнено 24 тренировки, перерыв — 21 день.',
        encouragement: 'Прогресс уже заметен в цифрах.',
        goalAlignment: '',
        nextSteps: ['Сравнить результат после следующих 4 тренировок.'],
        missingContext: [],
        analysisVersion: 'trainer-summary-v2',
      },
    }, trainingData)

    expect(issues).toEqual([])
  })

  it('rejects technical keys and a vague headline', () => {
    const issues = summaryQualityIssues({
      trainer: {
        headline: 'Наблюдается улучшение силовых показателей в некоторых упражнениях.',
        progress: ['В жиме лёжа рабочий вес вырос на 25%.', 'В беге темп улучшился на 10%.'],
        consistency: 'workouts_per_week составляет 0.9.',
        attention: [],
      },
      client: {
        headline: 'В жиме лёжа рабочий вес вырос на 25%.',
        achievements: ['В жиме лёжа рабочий вес вырос на 25%.', 'В беге темп улучшился на 10%.'],
        consistency: 'Средняя частота — 0,9 тренировки в неделю.',
        encouragement: 'Рост уже виден в цифрах.',
        goalAlignment: '',
        nextSteps: ['Сравнить ещё 4 тренировки.'],
        missingContext: [],
        analysisVersion: 'trainer-summary-v2',
      },
    }, trainingData)

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('технические идентификаторы'),
      expect.stringContaining('Headline'),
    ]))
  })

  it('requires a numeric current rhythm even in the first two weeks', () => {
    const issues = summaryQualityIssues({
      trainer: {
        headline: 'В жиме лёжа рабочий вес вырос на 25%.',
        progress: ['В жиме лёжа рабочий вес вырос на 25%.', 'В беге темп улучшился на 10%.'],
        consistency: 'Данных пока мало для оценки ритма.',
        attention: ['Проверить: стабильность тренировок после перерыва в 5 дней.'],
      },
      client: {
        headline: 'В жиме лёжа рабочий вес вырос на 25%.',
        achievements: ['В жиме лёжа рабочий вес вырос на 25%.', 'В беге темп улучшился на 10%.'],
        consistency: 'Данных пока мало для оценки ритма.',
        encouragement: 'Рост уже виден в цифрах.',
        goalAlignment: '',
        nextSteps: ['Сравнить ещё 4 тренировки.'],
        missingContext: [],
        analysisVersion: 'trainer-summary-v2',
      },
    }, {
      ...trainingData,
      consistency: {
        workouts_per_week: 2,
        longest_gap_days: 5,
        observation_days: 7,
      },
    })

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Короткий период'),
      expect.stringContaining('короче 7 дней'),
    ]))
  })

  it('rejects unsafe client language and unsupported trainer assumptions', () => {
    const issues = summaryQualityIssues({
      trainer: {
        headline: 'Есть динамика.',
        progress: ['В жиме лёжа вес вырос.', 'Бег изменился.'],
        consistency: 'Регулярность хорошая.',
        attention: ['Проверить усталость.'],
      },
      client: {
        headline: 'Ты увеличил вес.',
        achievements: ['В жиме лёжа вес вырос.', 'Бег изменился.'],
        consistency: 'Регулярность хорошая.',
        encouragement: 'Отличная работа, продолжай в том же духе!',
        goalAlignment: '',
        nextSteps: ['Увеличить вес.'],
        missingContext: [],
        analysisVersion: 'trainer-summary-v2',
      },
    }, trainingData)

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('императив'),
      expect.stringContaining('зависящая от рода'),
      expect.stringContaining('восклицательный'),
      expect.stringContaining('усталость'),
      expect.stringContaining('Регулярность нельзя'),
    ]))
  })

  it('requires goal-aware copy and readable rounding', () => {
    const issues = summaryQualityIssues({
      trainer: {
        headline: 'Вес вырос на 16,67%.',
        progress: ['В жиме лёжа вес вырос на 16,67%.', 'В беге темп улучшился на 10%.'],
        consistency: 'Средняя частота — 1,13 в неделю.',
        attention: [],
      },
      client: {
        headline: 'Вес вырос на 16,67%.',
        achievements: ['В жиме лёжа вес вырос на 16,67%.', 'В беге темп улучшился на 10%.'],
        consistency: 'Средняя частота — 1,13 в неделю.',
        encouragement: 'Изменения уже видны.',
        goalAlignment: '',
        nextSteps: ['Сравнить ещё 4 тренировки.'],
        missingContext: [],
        analysisVersion: 'trainer-summary-v2',
      },
    }, { ...trainingData, goal: { title: 'Рост силы' } })

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('целых процентов'),
      expect.stringContaining('один знак'),
      expect.stringContaining('goalAlignment'),
    ]))
  })

  it('rejects a lighter-week recommendation based on weight alone', () => {
    const issues = summaryQualityIssues({
      ...validCoachingSummary('Обсудить с тренером снижение нагрузки на следующей неделе.'),
    }, trainingData)

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('повторяющегося спада'),
    ]))
  })

  it('rejects machine-like copy, invented sleep claims and arbitrary ratings', () => {
    const summary = validCoachingSummary('Сравнить результат ещё через 3 тренировки.')
    summary.client.achievements = ['Плечи: наблюдается увеличение силы в некоторых упражнениях.']
    summary.client.encouragement = 'Главный ограничитель — сон. Итог месяца: 9/10.'

    const issues = summaryQualityIssues(summary, trainingData)

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('человеческим языком'),
      expect.stringContaining('десятибалльной'),
      expect.stringContaining('выводы о сне'),
    ]))
  })

  it('allows a lighter-week discussion only with repeated decline and recovery feedback', () => {
    const issues = summaryQualityIssues(
      validCoachingSummary('Обсудить с тренером снижение нагрузки на следующей неделе.'),
      {
        ...trainingData,
        feedback_signals: [{ date: '2026-08-20', session_rpe: 9, wellbeing: 'hard' }],
        exercises: [{
          name: 'Жим лёжа',
          session_count: 3,
          change_percent: { max_weight: -10 },
          sessions: [{ max_weight_kg: 70 }, { max_weight_kg: 67.5 }, { max_weight_kg: 63 }],
          derived_observations: [{ kind: 'repeated_load_decline', evidence_sessions: 3 }],
        }],
      },
    )

    expect(issues).toEqual([])
  })

  it('allows a grounded measurement to be the main conclusion even when exercise facts also changed', () => {
    const issues = summaryQualityIssues({
      trainer: {
        headline: 'Талия уменьшилась с 91 до 88 см за 2 замера.',
        progress: ['Изменение талии подтверждено 2 датированными замерами.'],
        consistency: 'Выполнено 2 тренировки.',
        attention: [],
      },
      client: {
        headline: 'Изменение талии подтверждено повторным замером, а не одной точкой.',
        achievements: ['Талия: изменение подтверждено 2 датированными замерами.'],
        consistency: 'Выполнено 2 тренировки.',
        encouragement: 'Изменение уже подтверждено замерами.',
        goalAlignment: '',
        nextSteps: ['Добавить следующий замер талии через 7 дней.'],
        missingContext: [],
        analysisVersion: 'trainer-summary-v2',
      },
    }, {
      ...trainingData,
      measurements: {
        changes: [{ metric: 'waist_cm', from: 91, to: 88, change: -3, evidence_points: 2 }],
        compared_to_previous_period: [],
      },
    })

    expect(issues).toEqual([])
  })
})

function validCoachingSummary(nextStep: string) {
  return {
    trainer: {
      headline: 'В жиме лёжа вес снизился на 10% за 3 тренировки.',
      progress: ['Вес снизился с 70 до 63 кг за 3 тренировки.'],
      consistency: 'Выполнено 3 тренировки.',
      attention: [],
    },
    client: {
      headline: 'Снижение рабочего веса повторилось в трёх тренировках.',
      achievements: ['Нагрузка: вес снизился с 70 до 63 кг за 3 тренировки.'],
      consistency: 'Выполнено 3 тренировки.',
      encouragement: 'Три записи уже позволяют увидеть направление изменений.',
      goalAlignment: '',
      nextSteps: [nextStep],
      missingContext: [],
      analysisVersion: 'trainer-summary-v2',
    },
  }
}
