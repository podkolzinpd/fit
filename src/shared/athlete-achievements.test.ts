import { describe, expect, it } from 'vitest'
import type { Workout } from './domain'
import { addDays, localDate } from './local-date'
import { computeAthleteAchievements, latestAthleteAchievement, newlyEarnedAchievements } from './athlete-achievements'

const today = localDate('2026-09-30')

function workout(index: number, date = addDays(localDate('2026-01-05'), index)): Workout {
  return { id: `workout-${index}`, clientId: 'client-1', status: 'done', workoutDate: date,
    completedAt: `${date}T12:00:00Z`, clientName: 'Спортсмен', startTime: null, endTime: null,
    startedAt: null, notes: null, stageId: null, stageTitle: null, version: 1, exercises: [],
  }
}

function earnedCount(count: number) {
  return computeAthleteAchievements(Array.from({ length: count }, (_, index) => workout(index)), today)
    .filter((item) => item.kind === 'workouts' && item.earnedOn).map((item) => item.threshold)
}

describe('athlete achievements', () => {
  it.each([
    [0, []], [1, [1]], [4, [1]], [5, [1, 5]], [9, [1, 5]], [10, [1, 5, 10]], [24, [1, 5, 10]],
    [25, [1, 5, 10, 25]], [49, [1, 5, 10, 25]], [50, [1, 5, 10, 25, 50]],
    [99, [1, 5, 10, 25, 50]], [100, [1, 5, 10, 25, 50, 100]],
  ])('unlocks precise workout thresholds at %i', (count, expected) => {
    expect(earnedCount(count)).toEqual(expected)
  })

  it.each([[3, []], [4, [4]], [7, [4]], [8, [4, 8]], [11, [4, 8]], [12, [4, 8, 12]]])('unlocks weekly thresholds at %i consecutive weeks', (count, expected) => {
    const items = Array.from({ length: count }, (_, index) => workout(index, addDays(localDate('2026-06-01'), index * 7)))
    const result = computeAthleteAchievements(items, today)
    expect(result.filter((item) => item.kind === 'weeks' && item.earnedOn).map((item) => item.threshold)).toEqual(expected)
  })

  it('treats Sunday and Monday as different weeks and one week with many workouts as one', () => {
    const items = [workout(0, localDate('2026-06-07')), workout(1, localDate('2026-06-08')),
      workout(2, localDate('2026-06-08')), workout(3, localDate('2026-06-15')),
      workout(4, localDate('2026-06-22'))]
    const result = computeAthleteAchievements(items, today)
    expect(result.find((item) => item.id === 'weeks-4')?.sourceWorkoutId).toBe('workout-4')
  })

  it('retains earned streaks after a break but resets progress toward the next one', () => {
    const run = Array.from({ length: 4 }, (_, index) => workout(index, addDays(localDate('2026-06-01'), index * 7)))
    const result = computeAthleteAchievements([...run, workout(4, localDate('2026-09-29'))], today)
    expect(result.find((item) => item.id === 'weeks-4')?.earnedOn).toBeTruthy()
    expect(result.find((item) => item.id === 'weeks-8')?.progress).toBe(1)
  })

  it('deduplicates done rows, excludes unfinished and cancelled, includes partial done workouts', () => {
    const first = workout(0)
    const result = computeAthleteAchievements([first, first, { ...workout(1), status: 'planned' },
      { ...workout(2), status: 'cancelled' }, { ...workout(3), exercises: [] }], today)
    expect(result.find((item) => item.id === 'workouts-10')?.progress).toBe(2)
    expect(result.find((item) => item.id === 'workouts-1')?.earnedOn).toBeTruthy()
  })

  it('attributes simultaneous thresholds to the triggering workout and picks one stable latest', () => {
    const items = [0, 1, 2, 3].map((index) => workout(index, addDays(localDate('2026-06-01'), index * 7)))
    const result = computeAthleteAchievements(items, today)
    expect(newlyEarnedAchievements(result, 'workout-3').map((item) => item.id)).toEqual(['weeks-4'])
    expect(latestAthleteAchievement(result)?.id).toBe('weeks-4')
  })

  it('shows two awards together when the tenth workout completes the fourth consecutive week', () => {
    const items = Array.from({ length: 10 }, (_, index) => workout(index, addDays(localDate('2026-06-01'), Math.floor(index / 3) * 7)))
    const result = computeAthleteAchievements(items, today)
    expect(newlyEarnedAchievements(result, 'workout-9').map((item) => item.id)).toEqual(['workouts-10', 'weeks-4'])
  })

  it('uses athlete timezone for the Monday boundary', () => {
    const sundayUtc = { ...workout(0, localDate('2026-06-07')), completedAt: '2026-06-07T22:30:00Z' }
    const mondayUtc = { ...workout(1, localDate('2026-06-08')), completedAt: '2026-06-08T08:00:00Z' }
    const result = computeAthleteAchievements([sundayUtc, mondayUtc], localDate('2026-06-08'), 'Europe/Moscow')
    expect(result.find((item) => item.id === 'weeks-4')?.progress).toBe(1)
  })

  it('awards 52 different training weeks across history without requiring a streak', () => {
    const history = Array.from({ length: 52 }, (_, index) => workout(index, addDays(localDate('2024-01-01'), index * 14)))
    const before = computeAthleteAchievements(history.slice(0, 51), today).find((item) => item.id === 'weeks-total-52')!
    expect(before).toMatchObject({ earnedOn: null, progress: 51, nearest: true })
    const awarded = computeAthleteAchievements([...history, workout(52, history[51]!.workoutDate)], today)
    expect(awarded.find((item) => item.id === 'weeks-total-52')).toMatchObject({ progress: 52, sourceWorkoutId: 'workout-51' })
    expect(awarded.find((item) => item.id === 'weeks-12')?.earnedOn).toBeNull()
  })

  it('awards a comeback only after 21 elapsed days between completed workouts', () => {
    const first = workout(0, localDate('2026-01-01'))
    const early = workout(1, localDate('2026-01-21'))
    expect(computeAthleteAchievements([first, early], today).find((item) => item.id === 'comeback-21'))
      .toMatchObject({ earnedOn: null, progress: 0, nearest: false })
    const returnWorkout = workout(2, localDate('2026-01-22'))
    expect(computeAthleteAchievements([first, { ...early, status: 'cancelled' }, returnWorkout], today).find((item) => item.id === 'comeback-21'))
      .toMatchObject({ progress: 21, sourceWorkoutId: 'workout-2' })
  })

  it('counts real personal records in distinct workouts, never the baseline or several metrics in one workout', () => {
    const withStrength = (index: number, weight: number, confirmed = true): Workout => ({ ...workout(index),
      exercises: [{ id: `exercise-${index}`, source: 'system', ref: 'squat', name: 'Присед', inputKind: 'strength', muscleGroup: 'legs', position: 0,
        blockId: 'block', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
        sets: [{ id: `set-${index}`, position: 0, version: 1, confirmedAt: confirmed ? '2026-01-01T12:00:00Z' : null,
          fact: { weightKg: weight, reps: 10 + index } }],
      }],
    })
    const baseline = withStrength(0, 40)
    expect(computeAthleteAchievements([baseline], today).find((item) => item.id === 'records-1')?.earnedOn).toBeNull()
    const firstRecord = withStrength(1, 45)
    const first = computeAthleteAchievements([baseline, firstRecord, withStrength(2, 100, false)], today)
    expect(first.find((item) => item.id === 'records-1')).toMatchObject({ sourceWorkoutId: firstRecord.id, progress: 1 })
    expect(first.find((item) => item.id === 'records-5')).toMatchObject({ earnedOn: null, progress: 1 })
    const four = [baseline, ...[1, 2, 3, 4].map((index) => withStrength(index, 40 + index * 5))]
    expect(computeAthleteAchievements([...four, four[4]!], today).find((item) => item.id === 'records-5')?.progress).toBe(4)
    const fifth = withStrength(5, 65)
    expect(computeAthleteAchievements([...four, fifth], today).find((item) => item.id === 'records-5'))
      .toMatchObject({ sourceWorkoutId: fifth.id, progress: 5 })
  })
})
