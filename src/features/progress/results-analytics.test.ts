import { describe, expect, it } from 'vitest'
import type { Workout, WorkoutExercise } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { resultExerciseKey, workoutResults } from '../../shared/workout-results'
import { volumeChangeDetails, weeklySetDistribution, workoutVolumeDetails } from './results-analytics'

function record(id: string, date: string, sets: Array<[number, number]>): Workout {
  const exercise: WorkoutExercise = { id: 'press', source: 'custom', customExerciseId: 'press', ref: 'press', name: 'Жим', muscleGroup: 'chest', inputKind: 'strength', position: 0, blockId: 'b', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
    sets: sets.map(([weightKg, reps], index) => ({ id: `s${index}`, position: index, weightKg: 999, reps: 999, fact: { weightKg, reps }, confirmedAt: date + 'T10:00:00Z', version: 1 })) }
  return { id, clientId: 'c', clientName: 'Тест', workoutDate: localDate(date), status: 'done', completedAt: date + 'T10:00:00Z', startedAt: null, startTime: null, endTime: null, notes: null, stageId: null, stageTitle: null, version: 1, exercises: [exercise] }
}

describe('weekly confirmed work and volume explanations', () => {
  it('clips boundary and current Monday weeks and counts cardio and unknown zones explicitly', () => {
    const cardio = record('cardio', '2026-08-11', [[0, 0]])
    cardio.exercises[0]!.inputKind = 'distance'; cardio.exercises[0]!.muscleGroup = 'cardio'; cardio.exercises[0]!.sets[0]!.fact = { distanceKm: 5 }
    const unknown = record('unknown', '2026-08-12', [[10, 10]]); unknown.exercises[0]!.muscleGroup = 'other'; unknown.exercises[0]!.name = 'Неопределённое движение'; unknown.exercises[0]!.ref = 'unknown'; unknown.exercises[0]!.customExerciseId = 'unknown'
    const result = weeklySetDistribution([record('earlier', '2026-07-31', [[10, 10]]), record('mapped', '2026-08-04', [[10, 10], [10, 10]]), cardio, unknown, record('future', '2026-08-13', [[10, 10]])], localDate('2026-08-01'), localDate('2026-08-31'), localDate('2026-08-12'))
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ start: '2026-08-01', end: '2026-08-02', partial: true, totalSets: 0 })
    expect(result[1]).toMatchObject({ start: '2026-08-03', end: '2026-08-09', partial: false, totalSets: 2, mappedSets: 2 })
    expect(result[2]).toMatchObject({ start: '2026-08-10', end: '2026-08-12', partial: true, totalSets: 2, cardioSets: 1, unknownSets: 1, mappedSets: 0 })
    expect(weeklySetDistribution([], localDate('2026-09-01'), localDate('2026-09-30'), localDate('2026-08-12'))).toEqual([])
  })
  it('explains actual set, repetition and weight changes across exact exercise identity', () => {
    const before = record('before', '2026-07-01', [[40, 10]])
    const after = record('after', '2026-08-02', [[50, 12], [50, 10]])
    after.exercises[0]!.name = 'Новое название'
    const result = workoutResults([before, after]).find((item) => item.workout.id === 'after' && item.metric === 'volume')!
    const explanation = volumeChangeDetails(result)!
    expect(explanation.changed).toEqual(['число подходов', 'сумма повторов', 'записанные веса'])
    expect(explanation.before).toMatchObject({ count: 1, reps: 10, volume: 400 })
    expect(explanation.after).toMatchObject({ count: 2, reps: 22, volume: 1100 })
    expect(explanation.after.volume).toBe(result.value)
    expect(explanation.before.volume).toBe(result.previous!.value)
  })
  it('detects changed combinations even when count, total reps and weight range are identical', () => {
    const before = record('before', '2026-08-01', [[10, 10], [20, 20]])
    const after = record('after', '2026-08-02', [[10, 20], [20, 10]])
    const result = workoutResults([before, after]).find((item) => item.workout.id === 'after' && item.metric === 'volume')!
    expect(result.state).toBe('decrease')
    expect(volumeChangeDetails(result)?.changed).toEqual(['сочетания веса и повторов в подходах'])
    after.exercises[0]!.sets.reverse()
    expect(volumeChangeDetails(workoutResults([before, after]).find((item) => item.workout.id === 'after' && item.metric === 'volume')!)?.after.combinations).toBe(volumeChangeDetails(result)?.after.combinations)
  })
  it('keeps a reordered stable result stable and does not explain baselines or non-volume metrics', () => {
    const before = record('before', '2026-08-01', [[10, 10], [20, 20]])
    const after = record('after', '2026-08-02', [[20, 20], [10, 10]])
    const results = workoutResults([before, after])
    expect(volumeChangeDetails(results.find((item) => item.workout.id === 'after' && item.metric === 'volume')!)?.changed).toEqual([])
    expect(volumeChangeDetails(results.find((item) => item.state === 'baseline' && item.metric === 'volume')!)).toBeNull()
    expect(volumeChangeDetails(results.find((item) => item.metric === 'weight')!)).toBeNull()
  })
  it('rejects incomplete, nonfinite, nonstrength or different-identity values instead of using the plan', () => {
    const workout = record('w', '2026-08-01', [[20, 10]])
    const key = resultExerciseKey(workout.exercises[0]!)
    workout.exercises[0]!.sets[0]!.fact = { weightKg: 20 }
    expect(workoutVolumeDetails(workout, key)).toBeNull()
    workout.exercises[0]!.sets[0]!.fact = { weightKg: Number.NaN, reps: 10 }
    expect(workoutVolumeDetails(workout, key)).toBeNull()
    workout.exercises[0]!.sets[0]!.fact = { weightKg: 20, reps: 10 }
    workout.exercises[0]!.sets[0]!.confirmedAt = null
    expect(workoutVolumeDetails(workout, key)).toBeNull()
    expect(workoutVolumeDetails(workout, 'another')).toBeNull()
  })
})
