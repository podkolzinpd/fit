import type { ParsedWorkoutExercise } from './quick-workout-entry'
import { PRESET_REST_DEFAULTS } from '../../data/repositories/workout-rules'

export interface ParsedWorkoutReviewBlock {
  id: string
  items: Array<{ item: ParsedWorkoutExercise; index: number }>
}

/** Не даёт молча потерять строку, которую парсер попросил уточнить. */
export function hasUnresolvedWorkoutReviewItems(
  parsedItems: readonly Pick<ParsedWorkoutExercise, 'line'>[],
  unmatched: readonly { line: string }[],
  choices: Readonly<Record<string, unknown>>,
): boolean {
  const parsedLines = new Set(parsedItems.map((item) => item.line))
  return unmatched.some((item) => !choices[item.line] && !parsedLines.has(item.line))
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

/** Объединяет соседний одиночный блок с одиночным упражнением или суперсетом. */
export function mergeParsedWorkoutReviewBlockWithNext(items: readonly ParsedWorkoutExercise[], itemIndex: number): ParsedWorkoutExercise[] {
  const blocks = groupParsedWorkoutReviewBlocks(items)
  const from = blocks.findIndex((block) => block.items.some(({ index }) => index === itemIndex))
  const current = blocks[from]
  const next = blocks[from + 1]
  if (!current || !next || current.items.at(-1)?.index !== itemIndex || next.items.length !== 1
    || current.items.some(({ item }) => item.structure?.blockPreset === 'interval' || item.structure?.blockPreset === 'circuit')
    || next.items.some(({ item }) => item.structure?.blockPreset === 'interval' || item.structure?.blockPreset === 'circuit' || item.structure?.blockType === 'group')) return [...items]

  const blockId = current.items[0]!.item.structure?.blockId ?? crypto.randomUUID()
  const members = [...current.items, ...next.items]
  const rounds = Math.max(1, ...members.map(({ item }) => item.sets.length))
  const memberIndexes = new Set(members.map(({ index }) => index))
  const rest = PRESET_REST_DEFAULTS.set
  return items.map((item, index) => memberIndexes.has(index) ? {
    ...item,
    structure: {
      ...item.structure,
      blockId,
      blockType: 'group' as const,
      blockPreset: 'set' as const,
      blockRounds: rounds,
      restBetweenExercisesSec: current.items[0]!.item.structure?.restBetweenExercisesSec ?? rest.betweenExercises,
      restBetweenRoundsSec: current.items[0]!.item.structure?.restBetweenRoundsSec ?? rest.betweenRounds,
    },
  } : item)
}

/** Разделяет только новый суперсет; значения подходов не меняет. */
export function splitParsedWorkoutReviewBlock(items: readonly ParsedWorkoutExercise[], itemIndex: number): ParsedWorkoutExercise[] {
  const blockId = items[itemIndex]?.structure?.blockId
  if (!blockId || items[itemIndex]?.structure?.blockPreset !== 'set') return [...items]
  return items.map((item) => item.structure?.blockId === blockId ? {
    ...item,
    structure: { ...item.structure, blockId: crypto.randomUUID(), blockType: 'single' as const, blockRounds: 1 },
  } : item)
}
