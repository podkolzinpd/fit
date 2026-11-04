import { blockRoundsView, currentRoundIndex, groupIntoBlocks } from '../../data/repositories/workout-rules'
import type { WorkoutExercise, WorkoutSet } from '../../shared/domain'

/** Resolve the next visible editor using the existing block/round order.
 * This does not start work, rest, or change any saved result. */
export function nextLiveTarget(exercises: WorkoutExercise[], preferredBlockId?: string): { exercise: WorkoutExercise; set: WorkoutSet } | undefined {
  const blocks = groupIntoBlocks(exercises)
  const pending = (block: typeof blocks[number]) => block.exercises.some(exercise => exercise.sets.some(set => !set.confirmedAt))
  const block = blocks.find(block => block.blockId === preferredBlockId && pending(block)) ?? blocks.find(pending)
  if (!block) return undefined
  if (block.exercises.length > 1) {
    const rounds = blockRoundsView(block)
    return rounds[currentRoundIndex(rounds)]?.items.find(({ set }) => !set.confirmedAt)
  }
  const exercise = block.exercises[0]!
  const set = exercise.sets.find(set => !set.confirmedAt)
  return set ? { exercise, set } : undefined
}
