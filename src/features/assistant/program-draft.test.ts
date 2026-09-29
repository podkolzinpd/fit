import { describe, expect, it } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { programWorkoutDrafts } from './program-draft'

describe('assistant program workout metrics', () => {
  const catalog: ExerciseSnapshot[] = [
    { source: 'system', ref: 'vital-stair-climber', name: 'Лестничный тренажёр', muscleGroup: 'cardio', inputKind: 'duration' },
    { source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration' },
  ]

  it('keeps exact seconds and independently measured distance in every planned set', () => {
    const drafts = programWorkoutDrafts('client', [{ title: 'Кардио', day: 'пн', exercises: [
      { name: 'Лестничный тренажёр', exerciseRef: 'vital-stair-climber', sets: 2, durationSec: 125, distanceKm: 0.8 },
      { name: 'Планка', exerciseRef: 'plank', sets: 1, durationMin: 1.5 },
    ] }], ['2026-10-01'], ['00000000-0000-4000-8000-000000000001'], catalog)
    expect(drafts?.[0]?.exercises[0]?.sets).toEqual([
      { position: 0, reps: undefined, weightKg: undefined, durationSec: 125, distanceKm: 0.8 },
      { position: 1, reps: undefined, weightKg: undefined, durationSec: 125, distanceKm: 0.8 },
    ])
    expect(drafts?.[0]?.exercises[1]?.sets[0]).toMatchObject({ durationSec: 90 })
    expect(drafts?.[0]?.exercises[1]?.sets[0]?.distanceKm).toBeUndefined()
  })
})
