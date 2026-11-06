import { expect, it } from 'vitest'
import { isValidRpe, RPE_OPTIONS } from './rpe'
it('accepts the complete set-RPE range and rejects gaps and out-of-range values', () => {
  expect(RPE_OPTIONS).toEqual([5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10])
  expect(RPE_OPTIONS.every(isValidRpe)).toBe(true)
  for (const value of [undefined, 0, 4.5, 5.25, 10.5, NaN, Infinity]) expect(isValidRpe(value)).toBe(false)
})
