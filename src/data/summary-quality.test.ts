import { describe, expect, it } from 'vitest'
import { summaryQualityIssues } from '../../supabase/functions/summarize-client-training/summary-quality'

const trainingData = {
  consistency: {
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
        headline: 'В жиме лёжа рабочий вес вырос на 25%, в беге темп — на 10%.',
        achievements: [
          'В жиме лёжа рабочий вес вырос на 25%.',
          'В беге темп улучшился на 10%.',
        ],
        consistency: 'Выполнено 24 тренировки, перерыв — 21 день.',
        encouragement: 'Прогресс уже заметен в цифрах.',
        goalAlignment: '',
        nextSteps: ['Сравнить результат после следующих 4 тренировок.'],
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
      },
    }, { ...trainingData, goal: { title: 'Рост силы' } })

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('целых процентов'),
      expect.stringContaining('один знак'),
      expect.stringContaining('goalAlignment'),
    ]))
  })
})
