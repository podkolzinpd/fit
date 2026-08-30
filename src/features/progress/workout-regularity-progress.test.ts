import { describe, expect, it } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { buildWorkoutRegularityProgress } from './workout-regularity-progress'

function workout(id: string, date: string, status: Workout['status'] = 'done'): Workout {
  return {
    id,
    clientId: 'client-1',
    clientName: 'Анна',
    workoutDate: localDate(date),
    startTime: null,
    endTime: null,
    startedAt: status === 'done' ? `${date}T09:00:00Z` : null,
    completedAt: status === 'done' ? `${date}T10:00:00Z` : null,
    status,
    notes: null,
    stageId: null,
    stageTitle: null,
    version: 1,
    exercises: [],
  }
}

const period = {
  periodStart: localDate('2026-08-03'),
  periodEnd: localDate('2026-08-30'),
  today: localDate('2026-08-30'),
}

describe('buildWorkoutRegularityProgress', () => {
  it('counts Monday-based active and missed weeks, intervals, pause and streak', () => {
    const result = buildWorkoutRegularityProgress({
      ...period,
      currentWorkouts: [
        workout('one', '2026-08-03'),
        workout('two', '2026-08-10'),
        workout('three', '2026-08-12'),
        workout('four', '2026-08-24'),
        workout('planned', '2026-08-18', 'planned'),
      ],
    })

    expect(result.weeks.map((week) => [week.start, week.workoutCount, week.status])).toEqual([
      ['2026-08-03', 1, 'active'],
      ['2026-08-10', 2, 'active'],
      ['2026-08-17', 0, 'missed'],
      ['2026-08-24', 1, 'active'],
    ])
    expect(result).toMatchObject({
      completedWorkouts: 4,
      elapsedWeeks: 4,
      activeWeeks: 3,
      missedWeeks: 1,
      averageIntervalDays: 7,
      longestGapDays: 12,
      currentStreakWeeks: 1,
      workoutsPerWeek: 1,
      pattern: 'stability',
    })
  })

  it('does not call an unfinished empty week missed', () => {
    const result = buildWorkoutRegularityProgress({
      currentWorkouts: [workout('one', '2026-08-03'), workout('two', '2026-08-10')],
      periodStart: localDate('2026-08-03'),
      periodEnd: localDate('2026-08-30'),
      today: localDate('2026-08-19'),
    })

    expect(result.weeks.map((week) => week.status)).toEqual(['active', 'active', 'current'])
    expect(result.elapsedWeeks).toBe(2)
    expect(result.missedWeeks).toBe(0)
    expect(result.currentStreakWeeks).toBe(2)
  })

  it('detects a return after a long internal pause', () => {
    const result = buildWorkoutRegularityProgress({
      ...period,
      currentWorkouts: [workout('one', '2026-08-03'), workout('two', '2026-08-05'), workout('three', '2026-08-28')],
    })

    expect(result.pattern).toBe('return')
    expect(result.longestGapDays).toBe(23)
    expect(result.explanation.text).toContain('После паузы 23 дн.')
  })

  it('compares equal periods and detects a meaningful frequency decline', () => {
    const current = [workout('c1', '2026-08-04'), workout('c2', '2026-08-18')]
    const previous = [
      workout('p1', '2026-07-07'), workout('p2', '2026-07-10'),
      workout('p3', '2026-07-14'), workout('p4', '2026-07-17'),
      workout('p5', '2026-07-21'), workout('p6', '2026-07-24'),
    ]
    const result = buildWorkoutRegularityProgress({
      ...period,
      currentWorkouts: current,
      previousWorkouts: previous,
      previousPeriodStart: localDate('2026-07-06'),
      previousPeriodEnd: localDate('2026-08-02'),
    })

    expect(result.previousWorkoutsPerWeek).toBe(1.5)
    expect(result.workoutsPerWeek).toBe(0.5)
    expect(result.frequencyChange).toBe(-1)
    expect(result.pattern).toBe('frequency_decline')
  })

  it('detects activity concentrated in one week', () => {
    const result = buildWorkoutRegularityProgress({
      ...period,
      currentWorkouts: [
        workout('one', '2026-08-03'), workout('two', '2026-08-04'),
        workout('three', '2026-08-05'), workout('four', '2026-08-18'),
      ],
    })

    expect(result.pattern).toBe('activity_concentration')
    expect(result.explanation.text).toContain('3 из 4 тренировок')
  })

  it('uses insufficient data for zero or one confirmed workout', () => {
    expect(buildWorkoutRegularityProgress({ ...period, currentWorkouts: [] }).pattern).toBe('insufficient_data')
    const one = buildWorkoutRegularityProgress({ ...period, currentWorkouts: [workout('one', '2026-08-05')] })
    expect(one.pattern).toBe('insufficient_data')
    expect(one.explanation.text).toContain('данных пока недостаточно')
  })

  it('accepts only a short fact-bound LLM pattern and rejects judgment or prescriptions', () => {
    const currentWorkouts = [
      workout('one', '2026-08-03'), workout('two', '2026-08-10'),
      workout('three', '2026-08-17'), workout('four', '2026-08-24'),
    ]
    const accepted = buildWorkoutRegularityProgress({
      ...period,
      currentWorkouts,
      llmCandidates: [
        'Ритм стабилен: 4 тренировки распределены по 4 неделям, частота — 9 в неделю.',
        'Ритм стабилен: 4 тренировки распределены по 4 неделям, частота — 1 в неделю.',
      ],
    })
    expect(accepted.explanation).toMatchObject({
      source: 'llm',
      text: 'Ритм стабилен: 4 тренировки распределены по 4 неделям, частота — 1 в неделю.',
    })

    const rejected = buildWorkoutRegularityProgress({
      ...period,
      currentWorkouts,
      llmCandidates: ['Из-за слабой дисциплины нужно добавить тренировки: 4 за 4 недели.'],
    })
    expect(rejected.explanation.source).toBe('deterministic')
    expect(rejected.explanation.text).not.toContain('дисциплины')
  })
})
