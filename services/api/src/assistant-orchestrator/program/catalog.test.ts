import { expect, it } from 'vitest'

import { eligibleProgramExercises } from './catalog.js'

it('offers kettlebell and resistance-band exercises without substituting dumbbells', () => {
  const catalog = eligibleProgramExercises(['kettlebells', 'resistance_bands'], [])
  expect(catalog.some((exercise) => exercise.equipment.includes('kettlebells'))).toBe(true)
  expect(catalog.some((exercise) => exercise.equipment.includes('resistance_bands'))).toBe(true)
  expect(catalog.some((exercise) => exercise.equipment.includes('dumbbells'))).toBe(false)
  expect(catalog.map((exercise) => exercise.ref)).toEqual(expect.arrayContaining([
    'fedb-goblet-squat',
    'fedb-one-arm-kettlebell-floor-press',
    'fedb-one-arm-kettlebell-row',
    'fedb-band-good-morning',
    'fedb-band-pull-apart',
  ]))
})
