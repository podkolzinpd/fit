import { describe, expect, it } from 'vitest'
import { SYSTEM_EXERCISES, SYSTEM_EXERCISE_CATALOG_VERSION } from './system-exercises'

describe('system exercise catalog', () => {
  it('matches the V1 baseline catalog', () => {
    expect(SYSTEM_EXERCISE_CATALOG_VERSION).toBe(1)
    expect(SYSTEM_EXERCISES).toHaveLength(49)
    expect(new Set(SYSTEM_EXERCISES.map((exercise) => exercise.ref)).size).toBe(49)
    expect(new Set(SYSTEM_EXERCISES.map((exercise) => exercise.name)).size).toBe(49)
  })

  it('preserves the V1 category distribution', () => {
    const count = (group: string) => SYSTEM_EXERCISES.filter((exercise) => exercise.muscleGroup === group).length
    expect({
      legs: count('legs'), chest: count('chest'), back: count('back'),
      shoulders: count('shoulders'), arms: count('arms'), core: count('core'), cardio: count('cardio'),
    }).toEqual({ legs: 11, chest: 7, back: 7, shoulders: 6, arms: 6, core: 5, cardio: 7 })
  })

  it('keeps the cardio input semantics', () => {
    expect(SYSTEM_EXERCISES.filter((exercise) => exercise.inputKind === 'distance')).toHaveLength(5)
    expect(SYSTEM_EXERCISES.filter((exercise) => exercise.inputKind === 'reps').map((exercise) => exercise.name))
      .toEqual(['Прыжки со скакалкой', 'Берпи'])
  })
})
