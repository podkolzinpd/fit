import { describe, expect, it } from 'vitest'
import type { GoalCriterion, InputKind, ProgressEntry, Workout, WorkoutSet } from './domain'
import { calculateTrainingGoalProgress } from './goal-training-progress'
import { localDate } from './local-date'

function criterion(overrides: Partial<GoalCriterion> = {}): GoalCriterion {
  return {
    id: 'criterion-1', goalId: 'goal-1', metric: 'exercise_working_weight', operation: 'increase_to',
    targetValue: 80, rangeMin: null, rangeMax: null, unit: 'кг', baselineValue: null, baselineRecordedOn: null,
    exerciseSource: 'system', exerciseRef: 'squat', exerciseName: 'Приседания', customExerciseId: null,
    confirmationStatus: 'confirmed', position: 0, version: 1, ...overrides,
  }
}

function set(id: string, fact: WorkoutSet['fact'], confirmed = true): WorkoutSet {
  return { id, position: 0, fact, confirmedAt: confirmed ? '2026-08-01T10:00:00Z' : null, version: 1 }
}

function workout(id: string, date: string, sets: WorkoutSet[], ref = 'squat', inputKind: InputKind = 'strength', status: Workout['status'] = 'done'): Workout {
  return {
    id, clientId: 'client-1', clientName: 'Клиент', workoutDate: localDate(date), startTime: null, endTime: null,
    startedAt: null, completedAt: `${date}T10:00:00Z`, status, notes: null, stageId: null, stageTitle: null, version: 1,
    exercises: [{ id: `${id}-exercise`, source: 'system', ref, name: ref, muscleGroup: 'legs', inputKind, position: 0,
      blockId: `${id}-block`, blockType: 'single', blockPreset: 'set', blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 60, sets }],
  }
}

const periodStart = localDate('2026-08-01')
const periodEnd = localDate('2026-08-31')
const today = localDate('2026-09-05')

describe('training and custom goal progress', () => {
  it('uses only confirmed facts of the selected real exercise', () => {
    const result = calculateTrainingGoalProgress(criterion(), [
      workout('first', '2026-08-01', [set('a', { weightKg: 70 })]),
      workout('second', '2026-08-31', [set('b', { weightKg: 80 }), set('plan', { weightKg: 120 }, false)]),
      workout('other', '2026-09-01', [set('c', { weightKg: 200 })], 'deadlift'),
    ], [], periodStart, periodEnd, today)
    expect(result.status).toBe('target_reached')
    expect(result.current?.value).toBe(80)
    expect(result.dynamics).toMatchObject({ count: 2, delta: 10, direction: 'toward_target' })
  })

  it('calculates reps and total training volume independently', () => {
    const source = [workout('one', '2026-08-20', [set('a', { weightKg: 50, reps: 10 }), set('b', { weightKg: 40, reps: 5 })])]
    const reps = calculateTrainingGoalProgress(criterion({ metric: 'exercise_reps', targetValue: 10, unit: 'повт.' }), source, [], periodStart, periodEnd, today)
    const volume = calculateTrainingGoalProgress(criterion({ metric: 'exercise_volume', targetValue: 700, unit: 'кг·повт.' }), source, [], periodStart, periodEnd, today)
    expect(reps.current?.value).toBe(10)
    expect(volume.current?.value).toBe(700)
    expect(volume.status).toBe('target_reached')
  })

  it('uses the configured unit for a best result instead of mixing incomparable facts', () => {
    const result = calculateTrainingGoalProgress(criterion({
      metric: 'exercise_best_result', unit: 'кг', targetValue: 100,
    }), [workout('one', '2026-08-20', [
      set('a', { weightKg: 80, reps: 12, durationMin: 120, distanceKm: 5 }),
      set('b', { weightKg: 90, reps: 2 }),
    ])], [], periodStart, periodEnd, today)
    expect(result.current?.value).toBe(90)
  })

  it('supports best results in reps, distance, duration and set volume', () => {
    const source = [workout('one', '2026-08-20', [
      set('a', { weightKg: 40, reps: 12, durationSec: 1_800, distanceKm: 5 }),
    ])]
    for (const [unit, expected] of [['повт.', 12], ['км', 5], ['мин', 30], ['кг·повт.', 480]] as const) {
      const result = calculateTrainingGoalProgress(criterion({
        metric: 'exercise_best_result', unit, targetValue: expected,
      }), source, [], periodStart, periodEnd, today)
      expect(result.current?.value).toBe(expected)
      expect(result.status).toBe('target_reached')
    }
  })

  it('ties cardio distance and duration to the same completed workout', () => {
    const source = [
      workout('slow', '2026-08-20', [set('a', { distanceKm: 5, durationSec: 2_100 })], 'run', 'distance'),
      workout('short', '2026-08-25', [set('b', { distanceKm: 4, durationSec: 1_500 })], 'run', 'distance'),
    ]
    const result = calculateTrainingGoalProgress(criterion({
      metric: 'cardio_distance_time', exerciseRef: 'run', exerciseName: 'Бег', targetValue: 5, unit: 'км', secondaryTargetValue: 30, secondaryUnit: 'мин',
    }), source, [], periodStart, periodEnd, today)
    expect(result.current).toMatchObject({ entryId: 'short', value: 4, secondaryValue: 25 })
    expect(result.status).toBe('target_not_reached')
  })

  it('calculates pace from linked distance and duration', () => {
    const result = calculateTrainingGoalProgress(criterion({
      metric: 'cardio_pace', exerciseRef: 'run', exerciseName: 'Бег', operation: 'decrease_to', targetValue: 6, unit: 'мин/км',
    }), [workout('run', '2026-08-25', [set('a', { distanceKm: 5, durationSec: 1_800 })], 'run', 'distance')], [], periodStart, periodEnd, today)
    expect(result.current?.value).toBe(6)
    expect(result.status).toBe('target_reached')
  })

  it('distinguishes average regularity from every completed period', () => {
    const source = [
      workout('w1', '2026-08-02', [set('a', { reps: 1 })]), workout('w2', '2026-08-03', [set('b', { reps: 1 })]),
      workout('w3', '2026-08-09', [set('c', { reps: 1 })]), workout('w4', '2026-08-10', [set('d', { reps: 1 })]),
      workout('w5', '2026-08-11', [set('e', { reps: 1 })]),
    ]
    const base = criterion({ metric: 'workout_regularity', exerciseSource: null, exerciseRef: null, exerciseName: null, operation: 'increase_to', targetValue: 2, unit: 'трен.', regularityPeriod: 'week' })
    const average = calculateTrainingGoalProgress({ ...base, regularityMode: 'average' }, source, [], periodStart, localDate('2026-08-15'), localDate('2026-08-15'))
    const each = calculateTrainingGoalProgress({ ...base, regularityMode: 'each_period' }, source, [], periodStart, localDate('2026-08-15'), localDate('2026-08-15'))
    expect(average.current?.value).toBeCloseTo(5 / 3)
    expect(average.status).toBe('target_not_reached')
    expect(each.regularity).toMatchObject({ completedPeriods: 1, totalPeriods: 2, mode: 'each_period' })
    expect(each.status).toBe('target_not_reached')
  })

  it('reads a selected custom metric, supports correction ordering and reports deleted source', () => {
    const entries: ProgressEntry[] = [{ id: 'old', clientId: 'client-1', createdBy: null, recordedOn: localDate('2026-08-01'), customMetrics: [{ metricId: 'sleep', value: 6 }], version: 1 },
      { id: 'new', clientId: 'client-1', createdBy: null, recordedOn: localDate('2026-08-31'), customMetrics: [{ metricId: 'sleep', value: 8 }], version: 2 }]
    const value = criterion({ metric: 'custom', exerciseSource: null, exerciseRef: null, exerciseName: null, customMetricId: 'sleep', customMetricName: 'Сон', unit: 'ч', targetValue: 8 })
    expect(calculateTrainingGoalProgress(value, [], entries, periodStart, periodEnd, today).status).toBe('target_reached')
    expect(calculateTrainingGoalProgress(value, [], entries, periodStart, periodEnd, today, false).sourceState).toBe('deleted')
  })

  it('ignores future, planned and unconfirmed data and marks old data stale', () => {
    const result = calculateTrainingGoalProgress(criterion(), [
      workout('old', '2026-07-01', [set('a', { weightKg: 70 })]),
      workout('planned', '2026-08-20', [set('b', { weightKg: 90 })], 'squat', 'strength', 'planned'),
      workout('future', '2026-09-06', [set('c', { weightKg: 90 })]),
    ], [], periodStart, periodEnd, today)
    expect(result.current?.value).toBe(70)
    expect(result.freshness).toBe('stale')
  })
})
