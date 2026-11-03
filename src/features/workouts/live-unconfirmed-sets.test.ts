import { afterEach, expect, it } from 'vitest'
import { createLiveUnconfirmedSets } from './live-unconfirmed-sets'
afterEach(() => sessionStorage.clear())
it('retains explicit timer holds through reload and isolates actors/workouts', () => {
  const hold = createLiveUnconfirmedSets('workout', 'athlete')
  hold.add('set')
  expect(createLiveUnconfirmedSets('workout', 'athlete').has('set')).toBe(true)
  expect(createLiveUnconfirmedSets('other-workout', 'athlete').has('set')).toBe(false)
  expect(createLiveUnconfirmedSets('workout', 'coach').has('set')).toBe(false)
  hold.delete('set')
  expect(createLiveUnconfirmedSets('workout', 'athlete').has('set')).toBe(false)
})
