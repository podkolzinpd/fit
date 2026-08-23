import { describe, expect, it } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import type { ParsedWorkoutExercise } from './quick-workout-entry'
import { groupParsedWorkoutReviewBlocks, moveParsedWorkoutReviewBlock } from './today-review-order'

function item(ref: string, blockId?: string): ParsedWorkoutExercise {
  const exercise: ExerciseSnapshot = { source: 'system', ref, name: ref, muscleGroup: 'other', inputKind: 'strength' }
  return { line: ref, exercise, sets: [{ position: 0 }], hasValues: false, ...(blockId ? { structure: { blockId, blockType: 'group' } } : {}) }
}

describe('today review order', () => {
  it('перемещает обычное упражнение на одну позицию', () => {
    const items = [item('a'), item('b'), item('c')]
    expect(moveParsedWorkoutReviewBlock(items, 1, -1).map(({ exercise }) => exercise.ref)).toEqual(['b', 'a', 'c'])
    expect(moveParsedWorkoutReviewBlock(items, 1, 1).map(({ exercise }) => exercise.ref)).toEqual(['a', 'c', 'b'])
  })

  it('перемещает интервальный блок целиком и сохраняет порядок внутри него', () => {
    const items = [item('warmup'), item('fast', 'intervals'), item('recovery', 'intervals'), item('cooldown')]
    const blocks = groupParsedWorkoutReviewBlocks(items)

    expect(blocks).toHaveLength(3)
    expect(moveParsedWorkoutReviewBlock(items, 2, -1).map(({ exercise }) => exercise.ref)).toEqual(['fast', 'recovery', 'warmup', 'cooldown'])
  })

  it('не меняет порядок на границах списка', () => {
    const items = [item('a'), item('b')]
    expect(moveParsedWorkoutReviewBlock(items, 0, -1).map(({ exercise }) => exercise.ref)).toEqual(['a', 'b'])
    expect(moveParsedWorkoutReviewBlock(items, 1, 1).map(({ exercise }) => exercise.ref)).toEqual(['a', 'b'])
  })
})
