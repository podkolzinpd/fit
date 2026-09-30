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
    [0, []], [1, [1]], [9, [1]], [10, [1, 10]], [24, [1, 10]],
    [25, [1, 10, 25]], [49, [1, 10, 25]], [50, [1, 10, 25, 50]],
    [99, [1, 10, 25, 50]], [100, [1, 10, 25, 50, 100]],
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
})
