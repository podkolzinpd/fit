import { describe, expect, it } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import type { WorkoutRegularityProgress } from './workout-regularity-progress'
import { buildTrainerProgressSignals } from './trainer-progress-signals'

function regularity(overrides: Partial<WorkoutRegularityProgress> = {}): WorkoutRegularityProgress {
  return {
    factId: 'regularity:period', completedWorkouts: 3, weeks: [], elapsedWeeks: 4,
    activeWeeks: 3, missedWeeks: 1, averageIntervalDays: 8, longestGapDays: 8,
    currentStreakWeeks: 1, workoutsPerWeek: 0.8, previousWorkoutsPerWeek: 1,
    frequencyChange: -0.2, pattern: 'stability',
    explanation: { text: 'Ритм', source: 'deterministic', factIds: ['regularity:period'] },
    ...overrides,
  }
}

function workout(id: string, options: Partial<Workout> = {}): Workout {
  return {
    id, clientId: 'client-1', clientName: 'Клиент', workoutDate: localDate('2026-08-10'),
    startTime: null, endTime: null, startedAt: null, completedAt: null, status: 'done',
    notes: null, stageId: null, stageTitle: null, version: 1, exercises: [],
    ...options,
  }
}

describe('buildTrainerProgressSignals', () => {
  it('limits output to three highest-priority verified signals', () => {
    const signals = buildTrainerProgressSignals({
      goal: {
        title: 'Улучшить форму', state: 'configured', statusLabel: 'Нужны данные',
        criteria: [{
          id: 'criterion-1', label: 'Плечи', target: 'увеличить до 120 см', status: 'Нужны данные',
          current: 'Нет данных', dynamics: 'Недостаточно данных', freshness: 'Нет данных',
          sufficiency: 'Нет замеров', dataOwner: 'measurement', action: 'measurement',
        }],
      },
      regularity: regularity({ completedWorkouts: 1, longestGapDays: 21 }),
      currentWorkouts: [
        workout('done-1'),
        workout('question-1', {
          workoutDate: localDate('2026-08-20'), clientQuestion: 'Оставить это упражнение в следующем плане?',
        }),
        workout('cancelled-1', { status: 'cancelled' }),
      ],
      summaryCompletedWorkouts: 6,
      today: localDate('2026-08-30'),
    })

    expect(signals).toHaveLength(3)
    expect(signals.map((signal) => signal.kind)).toEqual([
      'discussion_question', 'contradiction', 'criterion_without_data',
    ])
    expect(signals[0]).toMatchObject({
      fact: 'Клиент оставил вопрос после тренировки 20 августа 2026 г.',
      question: 'Оставить это упражнение в следующем плане?',
    })
    expect(signals.every((signal) => signal.factIds.length > 0)).toBe(true)
  })

  it('describes plan deviation, a long break and insufficient data as facts plus questions', () => {
    const signals = buildTrainerProgressSignals({
      regularity: regularity({ completedWorkouts: 1, longestGapDays: 18 }),
      currentWorkouts: [
        workout('done-1'),
        workout('overdue-1', { status: 'planned', workoutDate: localDate('2026-08-12') }),
      ],
      summaryCompletedWorkouts: 1,
      today: localDate('2026-08-30'),
    })

    expect(signals.map((signal) => signal.kind)).toEqual([
      'plan_deviation', 'break', 'insufficient_data',
    ])
    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ fact: '1 тренировка из периода не завершена по плану.' }),
      expect.objectContaining({ fact: 'Самый длинный интервал между завершёнными тренировками — 18 дн.' }),
    ]))
    expect(signals.every((signal) => signal.question.endsWith('?'))).toBe(true)
  })

  it('returns no signal when the available facts contain no gap or unresolved question', () => {
    expect(buildTrainerProgressSignals({
      regularity: regularity(),
      currentWorkouts: [workout('done-1'), workout('done-2'), workout('done-3')],
      summaryCompletedWorkouts: 3,
      today: localDate('2026-08-30'),
    })).toEqual([])
  })
})
