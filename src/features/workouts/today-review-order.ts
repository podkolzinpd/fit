import type { ParsedWorkoutExercise } from './quick-workout-entry'

export interface ParsedWorkoutReviewBlock {
  id: string
  items: Array<{ item: ParsedWorkoutExercise; index: number }>
}

/**
 * Интервалы и объединённые упражнения имеют общий blockId и должны
 * перемещаться целиком. Обычное упражнение образует отдельный блок.
 */
export function groupParsedWorkoutReviewBlocks(items: readonly ParsedWorkoutExercise[]): ParsedWorkoutReviewBlock[] {
  const blocks: ParsedWorkoutReviewBlock[] = []
  const byId = new Map<string, ParsedWorkoutReviewBlock>()
  items.forEach((item, index) => {
    const id = item.structure?.blockId ?? `__single-${index}`
    const existing = byId.get(id)
    if (existing) {
      existing.items.push({ item, index })
      return
    }
    const block = { id, items: [{ item, index }] }
    byId.set(id, block)
    blocks.push(block)
  })
  return blocks
}

/** Меняет местами соседние блоки, не разрывая их внутреннюю структуру. */
export function moveParsedWorkoutReviewBlock(items: readonly ParsedWorkoutExercise[], itemIndex: number, direction: -1 | 1): ParsedWorkoutExercise[] {
  const blocks = groupParsedWorkoutReviewBlocks(items)
  const from = blocks.findIndex((block) => block.items.some(({ index }) => index === itemIndex))
  const to = from + direction
  if (from < 0 || to < 0 || to >= blocks.length) return [...items]
  const reordered = [...blocks]
  ;[reordered[from], reordered[to]] = [reordered[to]!, reordered[from]!]
  return reordered.flatMap((block) => block.items.map(({ item }) => item))
}
