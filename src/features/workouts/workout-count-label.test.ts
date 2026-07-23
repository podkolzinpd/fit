import { describe, expect, it } from 'vitest'
import { workoutCountLabel } from './workout-count-label'

describe('workoutCountLabel', () => {
  it.each([
    [0, '0 тренировок'],
    [1, '1 тренировка'],
    [2, '2 тренировки'],
    [5, '5 тренировок'],
    [11, '11 тренировок'],
    [21, '21 тренировка'],
    [22, '22 тренировки'],
    [25, '25 тренировок'],
  ])('formats %i', (count, expected) => {
    expect(workoutCountLabel(count)).toBe(expected)
  })
})
