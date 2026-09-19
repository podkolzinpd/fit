import { describe, expect, it } from 'vitest'
import { parseFavoriteWorkout } from './favorite-workouts.repository'

describe('favorite workouts repository', () => {
  it('parses a stored favorite', () => {
    const exercises = [{
      source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength',
      position: 0, blockId: 'b1', blockType: 'single', blockPreset: 'set', blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90,
      sets: [{ position: 0, weightKg: 60, reps: 5 }],
    }]
    expect(parseFavoriteWorkout({
      id: '12acc6d6-7ca8-43cd-b124-b4224c917fae', title: 'Ноги и кор',
      createdAt: '2026-09-19T09:00:00.000Z', exercises,
    })).toEqual({
      id: '12acc6d6-7ca8-43cd-b124-b4224c917fae', title: 'Ноги и кор',
      createdAt: '2026-09-19T09:00:00.000Z', exercises,
    })
  })

  it.each([
    null,
    'not-an-object',
    { id: 1, title: 'Ноги', createdAt: '2026-09-19T09:00:00.000Z', exercises: [] },
    { id: 'a', title: 1, createdAt: '2026-09-19T09:00:00.000Z', exercises: [] },
    { id: 'a', title: 'Ноги', createdAt: 1, exercises: [] },
    { id: 'a', title: 'Ноги', createdAt: '2026-09-19T09:00:00.000Z', exercises: 'not-an-array' },
  ])('rejects malformed favorite data %#', (value) => {
    expect(() => parseFavoriteWorkout(value)).toThrow('Некорректные данные избранной тренировки')
  })
})
