import { expect, it } from 'vitest'
import type { WorkoutExercise } from '../../shared/domain'
import { nextLiveTarget } from './live-next-target'

function exercise(id: string, position: number, blockId = id, rounds = [0, 1]): WorkoutExercise {
  return { id, position, blockId, blockType: blockId === id ? 'single' : 'group', blockPreset: 'set', blockRounds: 2,
    sets: rounds.map(position => ({ id: `${id}-${position}`, position, confirmedAt: null, fact: {}, version: 1 })),
  } as WorkoutExercise
}
function done(exercise: WorkoutExercise, round: number) { exercise.sets.find(set => set.position === round)!.confirmedAt = '2026-11-04T09:00:00Z' }

it('visits the other member before a later round, without modifying facts', () => {
  const a = exercise('a', 0, 'group'), b = exercise('b', 1, 'group')
  done(a, 0)
  const before = structuredClone([a, b])
  expect(nextLiveTarget([a, b])?.set.id).toBe('b-0')
  expect([a, b]).toEqual(before)
  done(b, 0)
  expect(nextLiveTarget([a, b])?.set.id).toBe('a-1')
})
it('honors the selected pending block while a different earlier block is unfinished', () => {
  const earlier = exercise('earlier', 0), a = exercise('a', 1, 'selected'), b = exercise('b', 2, 'selected')
  done(a, 0)
  expect(nextLiveTarget([earlier, a, b], 'selected')?.set.id).toBe('b-0')
})
it('moves from a completed block to the next pending group, not a missing row', () => {
  const a = exercise('a', 0), b = exercise('b', 1, 'next'), c = exercise('c', 2, 'next')
  a.sets.forEach(set => { set.confirmedAt = 'done' })
  expect(nextLiveTarget([a, b, c], 'a')?.set.id).toBe('b-0')
})
it('uses saved round positions in a ragged legacy group and exercise position order', () => {
  const a = exercise('a', 0, 'group', [0, 2]), b = exercise('b', 1, 'group', [2])
  done(a, 0); done(a, 2)
  expect(nextLiveTarget([b, a])?.set.id).toBe('b-2')
})
it('handles a one-member legacy group and returns nothing after completion', () => {
  const a = exercise('a', 0, 'group')
  done(a, 0)
  expect(nextLiveTarget([a])?.set.id).toBe('a-1')
  done(a, 1)
  expect(nextLiveTarget([a])).toBeUndefined()
  expect(nextLiveTarget([])).toBeUndefined()
})
