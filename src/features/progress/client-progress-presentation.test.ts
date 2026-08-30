import { describe, expect, it } from 'vitest'
import type { ClientGoal, ProgressEntry, PublishedTrainingSummary, TrainingProgressFact, TrainingSummary, Workout, WorkoutPersonalRecord } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { clientProgressPresentation, progressStoryPresentation } from './client-progress-presentation'

function summary(progressFacts: TrainingProgressFact[] = []): PublishedTrainingSummary {
  return {
    id: 'published-1', sourceSummaryId: 'summary-1', clientId: 'client-1',
    periodStart: localDate('2026-07-24'), periodEnd: localDate('2026-08-24'),
    summary: { headline: 'Итог', achievements: [], consistency: 'Ритм', encouragement: 'Поддержка' },
    metrics: { completedWorkouts: 3, workoutsPerWeek: 1, activeWeeks: 3, longestGapDays: 5, progressFacts },
    generatedAt: '2026-08-24T18:00:00Z', publishedAt: '2026-08-24T18:05:00Z',
  }
}

function workout(id: string, date: string, confirmed: number, planned = confirmed): Workout {
  return {
    id, clientId: 'client-1', clientName: 'Антон', workoutDate: localDate(date), startTime: null, endTime: null,
    startedAt: null, completedAt: `${date}T10:00:00Z`, status: 'done', notes: null, stageId: null,
    stageTitle: null, version: 1, exercises: [{
      id: `${id}-exercise`, source: 'system', ref: 'dumbbell-press', name: 'Жим гантелей лёжа',
      muscleGroup: 'chest', inputKind: 'strength', position: 0,
      blockId: `${id}-block`, blockType: 'single', blockPreset: 'set', blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 60,
      sets: Array.from({ length: planned }, (_, index) => ({
        id: `${id}-set-${index}`, position: index, weightKg: 20, reps: 10, fact: { weightKg: 20, reps: 10 },
        confirmedAt: index < confirmed ? `${date}T10:0${index}:00Z` : null, version: 1,
      })),
    }],
  }
}

describe('clientProgressPresentation', () => {
  it('puts missing goal data above general training changes and exposes one exact action', () => {
    const value = summary([{
      exerciseName: 'Жим гантелей лёжа', kind: 'strength', sessionCount: 3,
      changes: [{ metric: 'max_weight', from: 20, to: 25, changePercent: 25, favorable: true }],
    }])
    const goal: ClientGoal = {
      id: 'goal-1', clientId: 'client-1', title: 'Увеличить вес до 85 кг', targetDate: null,
      status: 'active', version: 1, stages: [], criteria: [{
        id: 'criterion-1', goalId: 'goal-1', metric: 'weight', operation: 'increase_to',
        targetValue: 85, rangeMin: null, rangeMax: null, unit: 'кг', baselineValue: null,
        baselineRecordedOn: null, confirmationStatus: 'confirmed', position: 0, version: 1,
      }],
    }

    const result = clientProgressPresentation(value, { goal, today: localDate('2026-08-26') })

    expect(result.mainNow).toMatchObject({
      factId: 'goal:criterion-1:measurement', kind: 'data', title: 'Добавь актуальный замер',
      source: 'deterministic', action: 'measurement',
    })
    expect(result.mainNow.evidence).toContain('Вес · Нет данных')
  })

  it('describes movement away from a goal without turning it into positive copy', () => {
    const goal: ClientGoal = {
      id: 'goal-1', clientId: 'client-1', title: 'Увеличить вес до 85 кг', targetDate: null,
      status: 'active', version: 1, stages: [], criteria: [{
        id: 'criterion-1', goalId: 'goal-1', metric: 'weight', operation: 'increase_to',
        targetValue: 85, rangeMin: null, rangeMax: null, unit: 'кг', baselineValue: null,
        baselineRecordedOn: null, confirmationStatus: 'confirmed', position: 0, version: 1,
      }],
    }
    const measurements: ProgressEntry[] = [{
      id: 'm1', clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate('2026-07-24'),
      weightKg: 80, customMetrics: [], version: 1,
    }, {
      id: 'm2', clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate('2026-08-24'),
      weightKg: 79, customMetrics: [], version: 1,
    }]

    const result = clientProgressPresentation(summary(), { goal, measurements, today: localDate('2026-08-26') })

    expect(result.mainNow).toMatchObject({
      factId: 'goal:criterion-1:tracking', kind: 'goal', title: 'Положение стало дальше от ориентира',
      source: 'deterministic',
    })
    expect(result.mainNow.evidence).toContain('79 кг · Дальше от ориентира')
  })

  it('uses a verified personal record instead of calling a period delta a record', () => {
    const record: WorkoutPersonalRecord = {
      exerciseRef: 'bench-press', exerciseName: 'Жим лёжа', inputKind: 'strength', metric: 'weight_reps',
      primaryValue: 75, weightKg: 75, reps: 8,
    }
    const result = clientProgressPresentation(summary(), {
      personalRecords: [record],
      personalRecordWorkout: { id: 'workout-record', workoutDate: localDate('2026-08-24') },
    })

    expect(result.mainNow).toEqual({
      factId: 'personal-record:workout-record:bench-press:weight_reps', kind: 'personal_record',
      title: 'Новый личный рекорд · Жим лёжа', explanation: 'Результат подтверждён в завершённой тренировке.',
      evidence: '75 кг × 8 повт. · 24.08.2026', source: 'deterministic', subject: 'Жим лёжа',
    })
  })

  it('accepts LLM wording only when its subject and number match a deterministic fact', () => {
    const value = summary([{
      exerciseName: 'Тяга верхнего блока', kind: 'strength', sessionCount: 3,
      changes: [{ metric: 'max_weight', from: 50, to: 68, changePercent: 36, favorable: true }],
    }])
    value.summary.headline = 'В тяге верхнего блока рабочий вес вырос на 36%.'

    const result = clientProgressPresentation(value, { upcomingWorkouts: [
      { ...workout('next', '2026-08-28', 0), status: 'planned', completedAt: null },
    ] })

    expect(result.mainNow.source).toBe('llm')
    expect(result.mainNow.factId).toBe('exercise:тяга верхнего блока:36')
    expect(result.mainNow.explanation).toBe('В тяге верхнего блока рабочий вес вырос на 36%.')
    expect(result.mainNow.evidence).toContain('50 → 68 кг · +36%')
  })

  it('rejects an ungrounded LLM claim and keeps the deterministic fact', () => {
    const value = summary([{
      exerciseName: 'Тяга верхнего блока', kind: 'strength', sessionCount: 3,
      changes: [{ metric: 'max_weight', from: 50, to: 68, changePercent: 36, favorable: true }],
    }])
    value.summary.headline = 'В приседаниях результат вырос на 99%.'

    const result = clientProgressPresentation(value)

    expect(result.mainNow).toMatchObject({
      factId: 'exercise:тяга верхнего блока:36', source: 'deterministic',
      explanation: 'Это наиболее выраженное подтверждённое изменение упражнения за период.',
    })
    expect(result.mainNow.explanation).not.toContain('99%')
  })

  it('prioritizes a long confirmed gap above positive load changes', () => {
    const value = summary([{
      exerciseName: 'Тяга верхнего блока', kind: 'strength', sessionCount: 3,
      changes: [{ metric: 'max_weight', from: 50, to: 68, changePercent: 36, favorable: true }],
    }])
    value.metrics.longestGapDays = 18
    value.summary.consistency = 'Самая длинная пауза составила 18 дней.'

    expect(clientProgressPresentation(value).mainNow).toMatchObject({
      factId: 'regularity:gap:18', kind: 'gap', title: 'В ритме была длинная пауза',
      evidence: '18 дней без тренировок', source: 'llm',
    })
  })

  it('compares real workouts and one measurable exercise result with the previous period', () => {
    const currentFirst = workout('current-1', '2026-08-03', 3)
    const currentSecond = workout('current-2', '2026-08-10', 3)
    const previous = workout('previous-1', '2026-07-10', 2)
    currentFirst.exercises[0]!.sets.forEach((set) => { set.fact.weightKg = 24 })
    currentSecond.exercises[0]!.sets.forEach((set) => { set.fact.weightKg = 25 })
    const result = clientProgressPresentation(summary(), {
      currentWorkouts: [currentFirst, currentSecond],
      previousWorkouts: [previous],
    })

    expect(result.comparison?.items).toEqual(expect.arrayContaining([
      { value: '+1', label: 'тренировка к предыдущему периоду', tone: 'positive' },
      { value: '+25%', label: 'Жим гантелей лёжа: рабочий вес 20 → 25 кг', tone: 'positive' },
    ]))
    expect(result.stats.slice(0, 2)).toEqual([
      { value: '2', label: 'тренировки' },
      { value: '2/6', label: 'недель с тренировками' },
    ])
  })

  it('shows only the confirmed criterion foundation without inventing goal achievement', () => {
    const measurements: ProgressEntry[] = [{
      id: 'm1', clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate('2026-07-24'),
      weightKg: 80, customMetrics: [], version: 1,
    }, {
      id: 'm2', clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate('2026-08-24'),
      weightKg: 81.5, customMetrics: [], version: 1,
    }, {
      id: 'm3', clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate('2026-08-25'),
      weightKg: 90, customMetrics: [], version: 1,
    }]
    const result = clientProgressPresentation(summary(), {
      goal: {
        id: 'goal-1', clientId: 'client-1', title: 'Набрать мышечную массу', targetDate: null,
        status: 'active', version: 1, stages: [], criteria: [{
          id: 'criterion-1', goalId: 'goal-1', metric: 'weight', operation: 'increase_to',
          targetValue: 85, rangeMin: null, rangeMax: null, unit: 'кг',
          baselineValue: null, baselineRecordedOn: null,
          confirmationStatus: 'confirmed', position: 0, version: 1,
        }],
      }, measurements,
      currentWorkouts: [workout('current', '2026-08-03', 2, 3)],
    })

    expect(result.goal).toEqual({
      title: 'Набрать мышечную массу',
      state: 'configured',
      statusLabel: 'Настроено',
      criterionLabel: 'Вес',
      targetLabel: 'увеличить до 85 кг',
    })
  })

  it('does not infer a criterion from a legacy free-text goal', () => {
    expect(clientProgressPresentation(summary(), {
      profileGoal: 'Держать вес 59 кг',
      measurements: [{
        id: 'm1', clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate('2026-08-24'),
        weightKg: 59, customMetrics: [], version: 1,
      }],
    }).goal).toEqual({
      title: 'Держать вес 59 кг',
      state: 'unconfigured',
      statusLabel: 'Не настроено',
    })
  })

  it('uses the exact upcoming plan instead of inventing a recommendation', () => {
    const planned = { ...workout('next', '2026-08-28', 0, 3), status: 'planned' as const, completedAt: null, startTime: '18:30' }
    const result = clientProgressPresentation(summary(), {
      today: localDate('2026-08-26'), upcomingWorkouts: [planned],
    })

    expect(result.nextWorkout).toEqual({
      date: '28 августа 2026 г. · 18:30', title: 'Ближайшая тренировка',
      exercises: [{ name: 'Жим гантелей лёжа', plan: '3 × 20 кг × 10 повт.' }],
    })
  })

  it('keeps an honest comparison baseline without inventing goal movement or a next step', () => {
    const result = clientProgressPresentation(summary())
    expect(result.comparison).toEqual({
      title: 'Сравнение периодов',
      items: [],
      emptyMessage: 'Текущий период сохранён как отправная точка. Сравнение появится, когда накопится следующий сопоставимый период.',
    })
    expect(result.goal).toBeUndefined()
    expect(result.nextWorkout).toBeUndefined()
  })

  it('keeps only evidence-based orientations and removes generic filler', () => {
    const value = summary([{
      exerciseName: 'Гиперэкстензия', kind: 'strength', sessionCount: 1, changes: [],
    }])
    value.summary.nextSteps = [
      'Поддерживать регулярность тренировок.',
      'Собрать данные о количестве повторений в гиперэкстензии.',
      'На следующей тренировке выполнить 3 подтверждённых подхода.',
      'Слушать своё тело.',
    ]

    const result = clientProgressPresentation(value)

    expect(result.orientations).toEqual([
      'Собрать данные о количестве повторений в гиперэкстензии.',
      'На следующей тренировке выполнить 3 подтверждённых подхода.',
    ])
  })

  it('counts a partially completed workout as completed while keeping only confirmed sets', () => {
    const result = clientProgressPresentation(summary(), {
      currentWorkouts: [workout('partial', '2026-08-10', 2, 3)],
    })

    expect(result.stats[0]).toEqual({ value: '1', label: 'тренировка' })
    expect(result.goal).toBeUndefined()
  })

  it('builds the same factual story for the client and trainer roles', () => {
    const published = summary()
    const trainer: TrainingSummary = {
      id: 'summary-1', clientId: published.clientId,
      periodStart: published.periodStart, periodEnd: published.periodEnd,
      trainer: { headline: 'Внутренний вывод', progress: [], consistency: 'Ритм', attention: [] },
      client: published.summary, metrics: published.metrics,
      generatedAt: published.generatedAt, version: 1, published: true,
    }
    const options = {
      currentWorkouts: [workout('current', '2026-08-10', 2, 3)],
      previousWorkouts: [workout('previous', '2026-07-10', 1)],
      today: localDate('2026-08-26'),
    }

    const client = progressStoryPresentation(published, { ...options, role: 'client' })
    const trainerView = progressStoryPresentation(trainer, { ...options, role: 'trainer' })

    expect(trainerView.hero).toEqual(client.hero)
    expect(trainerView.stats).toEqual(client.stats)
    expect(trainerView.wins).toEqual(client.wins)
    expect(trainerView.comparison).toEqual(client.comparison)
  })

  it('keeps old published summaries useful before structured facts were introduced', () => {
    const legacy = summary()
    legacy.summary = {
      headline: 'За последний месяц рабочий вес в жиме вырос на 4%.',
      achievements: ['Жим лёжа: рабочий вес вырос с 72 до 75 кг.', 'Приседания: объём сохранился на уровне прошлого месяца.'],
      consistency: 'За четыре недели выполнено 4 тренировки.',
      encouragement: 'Первый заметный сдвиг уже есть.',
    }

    const result = clientProgressPresentation(legacy, { currentWorkouts: [] })

    expect(result.hero).toEqual({
      value: '+4%',
      exerciseName: 'Жим лёжа',
      detail: 'Рабочий вес: 72 → 75 кг · +4%',
    })
    expect(result.stats).toEqual([
      { value: '3', label: 'тренировки' },
      { value: '3/6', label: 'недель с тренировками' },
      { value: '1', label: 'упражнение улучшено' },
    ])
  })
})
