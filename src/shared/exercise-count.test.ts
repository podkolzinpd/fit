import { expect, it } from 'vitest'
import { exerciseCountText } from './exercise-count'

it.each([[0, 'упражнений'], [1, 'упражнение'], [4, 'упражнения'], [5, 'упражнений'], [11, 'упражнений'], [14, 'упражнений'], [21, 'упражнение'], [24, 'упражнения']] as const)('declines %i exercises', (count, word) => {
  expect(exerciseCountText(count)).toBe(`${count} ${word}`)
})
