import { blockRoundsView, currentRoundIndex, groupIntoBlocks } from '../../data/repositories/workout-rules'
import type { WorkoutExercise, WorkoutSet } from '../../shared/domain'

/** Resolve the next visible editor using the existing block/round order.
 * This does not start work, rest, or change any saved result. */
export function nextLiveTarget(exercises: WorkoutExercise[], preferredBlockId?: string, forwardFromSelected = false, preferredRoundPosition?: number): { exercise: WorkoutExercise; set: WorkoutSet } | undefined {
  const blocks = groupIntoBlocks(exercises)
  const pending = (block: typeof blocks[number]) => block.exercises.some(exercise => exercise.sets.some(set => !set.confirmedAt))
  const selectedIndex = blocks.findIndex(block => block.blockId === preferredBlockId)
  const ordered = forwardFromSelected && selectedIndex >= 0
    ? [...blocks.slice(selectedIndex), ...blocks.slice(0, selectedIndex)] : blocks
  const block = blocks.find(block => block.blockId === preferredBlockId && pending(block)) ?? ordered.find(pending)
  if (!block) return undefined
  if (block.exercises.length > 1) {
    const rounds = blockRoundsView(block)
    const selectedRound = block.blockId === preferredBlockId && preferredRoundPosition !== undefined
      ? rounds.findIndex(round => round.round === preferredRoundPosition + 1) : -1
    const orderedRounds = selectedRound >= 0
      ? [...rounds.slice(selectedRound), ...rounds.slice(0, selectedRound)] : rounds
    return orderedRounds[currentRoundIndex(orderedRounds)]?.items.find(({ set }) => !set.confirmedAt)
  }
  const exercise = block.exercises[0]!
  const set = exercise.sets.find(set => !set.confirmedAt)
  return set ? { exercise, set } : undefined
}
