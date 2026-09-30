import { describe, expect, it } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import type { ParsedWorkoutExercise } from './quick-workout-entry'
import { groupParsedWorkoutReviewBlocks, hasUnresolvedWorkoutReviewItems, mergeParsedWorkoutReviewBlockWithNext, moveParsedWorkoutReviewBlock, splitParsedWorkoutReviewBlock } from './today-review-order'

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

  it('объединяет три упражнения в суперсет без потери значений и возвращает одиночные', () => {
    const original = [
      { ...item('bench'), sets: [{ position: 0, weightKg: 60, reps: 10 }, { position: 1, weightKg: 65, reps: 8 }], hasValues: true },
      { ...item('plank'), sets: [{ position: 0, durationSec: 45 }], hasValues: true },
      item('squat'),
    ]
    const pair = mergeParsedWorkoutReviewBlockWithNext(original, 0)
    const triple = mergeParsedWorkoutReviewBlockWithNext(pair, 1)
    expect(groupParsedWorkoutReviewBlocks(triple)).toHaveLength(1)
    expect(triple.map(({ structure }) => structure?.blockPreset)).toEqual(['set', 'set', 'set'])
    expect(triple.map(({ structure }) => structure?.blockRounds)).toEqual([2, 2, 2])
    expect(triple.map(({ sets }) => sets)).toEqual(original.map(({ sets }) => sets))
    expect(splitParsedWorkoutReviewBlock(triple, 0).map(({ structure }) => structure?.blockType)).toEqual(['single', 'single', 'single'])
  })

  it('не объединяет интервальные и исторические круговые блоки', () => {
    const interval = { ...item('run'), structure: { blockId: 'interval', blockType: 'single' as const, blockPreset: 'interval' as const } }
    const circuit = { ...item('old'), structure: { blockId: 'old', blockType: 'group' as const, blockPreset: 'circuit' as const } }
    expect(mergeParsedWorkoutReviewBlockWithNext([interval, item('a')], 0)[0]).toEqual(interval)
    expect(mergeParsedWorkoutReviewBlockWithNext([circuit, item('a')], 0)[0]).toEqual(circuit)
    expect(mergeParsedWorkoutReviewBlockWithNext([item('a'), interval], 0)[0]?.structure).toBeUndefined()
    expect(mergeParsedWorkoutReviewBlockWithNext([item('a'), { ...circuit, structure: { ...circuit.structure, blockType: 'single' } }], 0)[0]?.structure).toBeUndefined()
  })

  it('не разрешает перейти к проверке, пока неоднозначная строка не выбрана', () => {
    const parsed = [item('bench'), item('plank')]
    const unmatched = [{ line: 'гантели на бицепс 15 кг 15 раз 3 подхода' }]

    expect(hasUnresolvedWorkoutReviewItems(parsed, unmatched, {})).toBe(true)
    expect(hasUnresolvedWorkoutReviewItems(parsed, unmatched, { [unmatched[0]!.line]: { ref: 'biceps-curl' } })).toBe(false)
    expect(hasUnresolvedWorkoutReviewItems([...parsed, { ...item('biceps-curl'), line: unmatched[0]!.line }], unmatched, {})).toBe(false)
  })
})
