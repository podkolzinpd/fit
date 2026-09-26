import type { ExerciseSnapshot } from './domain'
import { EXERCISE_CATALOG_DECISIONS } from './exercise-catalog-decisions'
import { SYSTEM_EXERCISES, SYSTEM_EXERCISE_CATALOG, SYSTEM_EXERCISE_LEGACY_CATALOG } from './system-exercises'

const byRef = new Map(SYSTEM_EXERCISE_CATALOG.map((exercise) => [exercise.ref, exercise]))
const legacyByRef = new Map(SYSTEM_EXERCISE_LEGACY_CATALOG.map((exercise) => [exercise.ref, exercise]))

const normalizedName = (name: string) => name.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ')
const priorNamesByRef = new Map<string, Set<string>>()
for (const exercise of [...SYSTEM_EXERCISES, ...SYSTEM_EXERCISE_LEGACY_CATALOG]) {
  const names = priorNamesByRef.get(exercise.ref) ?? new Set<string>()
  names.add(normalizedName(exercise.name))
  priorNamesByRef.set(exercise.ref, names)
}

/** Only a new copy may refresh a known catalog label; never infer identity from text. */
export function copiedExerciseName(exercise: ExerciseSnapshot): string {
  if (exercise.source !== 'system' || exercise.customExerciseId) return exercise.name
  const current = byRef.get(exercise.ref)
  const legacy = legacyByRef.get(exercise.ref)
  // A completed workout may still carry the reviewed exercise's former metric.
  // Accept that exact historical snapshot, but keep rejecting arbitrary field
  // mismatches so an unrelated exercise is never renamed by ref alone.
  if (!current || (current.inputKind !== exercise.inputKind && legacy?.inputKind !== exercise.inputKind)) return exercise.name
  // Preserve running formats and any trainer-authored or otherwise unknown label.
  return priorNamesByRef.get(exercise.ref)?.has(normalizedName(exercise.name)) ? current.name : exercise.name
}

// Same movement is not enough: converting reps/time to weight+reps would lose
// data. Such aliases become explicit variants instead of silent replacements.
export const COMPATIBLE_EXERCISE_REPLACEMENTS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EXERCISE_CATALOG_DECISIONS).flatMap(([ref, decision]) =>
    decision.action === 'duplicate' && decision.target
      && legacyByRef.get(ref)?.inputKind === legacyByRef.get(decision.target)?.inputKind
      && byRef.get(ref)?.inputKind === byRef.get(decision.target)?.inputKind
      ? [[ref, decision.target]] : []),
)

/**
 * Additional picker-only duplicates discovered after the final Gym Pro import.
 * They remain in the full registry so old workouts keep their refs and metrics.
 */
export const PICKER_ONLY_EXERCISE_REPLACEMENTS: Readonly<Record<string, string>> = {
  'fedb-concentration-curls': 'vital-concentration-curl-seated-dumbbell-ex014',
  'fedb-inchworm': 'vital-inch-worm-ex309',
  'fedb-plyo-push-up': 'vital-plyometric-pushup-ex495',
  'fedb-single-arm-push-up': 'vital-one-hand-pushup-ex230',
  'vital-gym-pro-r020-1120': 'close-grip-push-up',
  'vital-gym-pro-r027-1142': 'fedb-hanging-leg-raise',
  'vital-gym-pro-r031-1170': 'vital-one-hand-pushup-ex230',
  'vital-gym-pro-r042-1208': 'fedb-push-up-wide',
  'vital-gym-pro-r062-0147': 'biceps-curl',
  'vital-gym-pro-r086-0212': 'running-butt-kicks',
  'vital-gym-pro-r087-0213': 'running-high-knees',
  'vital-gym-pro-r088-0218': 'vital-place-jog-cardio-ex215',
  'vital-gym-pro-r091-0223': 'vital-diamond-pushup-ex141',
  'vital-gym-pro-r120-0272': 'leg-raise',
  'vital-gym-pro-r140-1255': 'vital-resistance-band-lat-pulldown-ex198',
  'vital-gym-pro-r150-1273': 'fedb-one-legged-cable-kickback',
  'vital-gym-pro-r151-1276': 'vital-chin-up-leg-folded-ex031',
  'vital-gym-pro-r156-1284': 'vital-dumbbell-skull-crusher-ex147',
  'vital-gym-pro-r161-1292': 'fedb-monster-walk',
  'vital-gym-pro-r199-1518': 'vital-wall-ball-squat-ex799',
  'vital-gym-pro-r220-1544': 'vital-dragon-flags-core-mastery-ex363',
  'vital-gym-pro-r276-1606': 'vital-dumbbell-drag-ex107',
  'vital-gym-pro-r294-1635': 'vital-standing-dumbbell-press',
  'vital-gym-pro-r321-1363': 'fedb-dumbbell-rear-lunge',
  'vital-gym-pro-r322-1365': 'elliptical',
  'vital-gym-pro-r353-1425': 'vital-toe-touch-crunch-ex125',
  'vital-gym-pro-r425-1739': 'fedb-kneeling-single-arm-high-pulley-row',
}

const RAW_EXERCISE_PICKER_REPLACEMENTS: Readonly<Record<string, string>> = {
  ...COMPATIBLE_EXERCISE_REPLACEMENTS,
  ...PICKER_ONLY_EXERCISE_REPLACEMENTS,
}

const finalPickerReplacement = (ref: string): string => {
  const visited = new Set<string>()
  let target = ref
  while (RAW_EXERCISE_PICKER_REPLACEMENTS[target] && !visited.has(target)) {
    visited.add(target)
    target = RAW_EXERCISE_PICKER_REPLACEMENTS[target]!
  }
  return target
}

export const EXERCISE_PICKER_REPLACEMENTS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RAW_EXERCISE_PICKER_REPLACEMENTS).map(([ref, target]) => [ref, finalPickerReplacement(target)]),
)

export type CatalogSection = 'core' | 'uncommon' | 'rare' | 'formats'
export const CATALOG_SECTIONS: ReadonlyArray<{ value: CatalogSection; label: string }> = [
  { value: 'core', label: 'Основные' },
  { value: 'uncommon', label: 'Дополнительные' },
  { value: 'rare', label: 'Редкие и специальные' },
  { value: 'formats', label: 'Форматы тренировки' },
]

export function exerciseCatalogRoot(exercise: ExerciseSnapshot): string {
  if (exercise.source !== 'system') return exercise.ref
  const decision = EXERCISE_CATALOG_DECISIONS[exercise.ref]
  // Formats are independent recording templates, not movement substitutions.
  return decision?.action !== 'format' ? decision?.target ?? exercise.ref : exercise.ref
}

export function isCatalogRoot(exercise: ExerciseSnapshot): boolean {
  return exerciseCatalogRoot(exercise) === exercise.ref
}

export function exerciseCatalogSection(exercise: ExerciseSnapshot): CatalogSection {
  if (exercise.source === 'custom') return 'core'
  const decision = EXERCISE_CATALOG_DECISIONS[exerciseCatalogRoot(exercise)]
  if (decision?.action === 'format') return 'formats'
  return decision?.tier === 'core' || decision?.tier === 'rare' ? decision.tier : 'uncommon'
}

const CATALOG_BROWSE_PRIORITY: Record<CatalogSection, number> = { core: 0, uncommon: 1, formats: 2, rare: 3 }

/** One catalog, ordered by usefulness: familiar movements first, special cases later. */
export function compareCatalogBrowseOrder(left: ExerciseSnapshot, right: ExerciseSnapshot): number {
  return CATALOG_BROWSE_PRIORITY[exerciseCatalogSection(left)] - CATALOG_BROWSE_PRIORITY[exerciseCatalogSection(right)]
    || left.name.localeCompare(right.name, 'ru')
}

/** Collapse ranked results by movement, retaining the best matching variant. */
export function groupCatalogResults(exercises: readonly ExerciseSnapshot[]): ExerciseSnapshot[] {
  const seen = new Set<string>()
  return exercises.filter((exercise) => {
    const key = `${exercise.source}:${exerciseCatalogRoot(exercise)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function exerciseCatalogVariants(exercise: ExerciseSnapshot, catalog: readonly ExerciseSnapshot[]): readonly ExerciseSnapshot[] {
  if (exercise.source !== 'system') return []
  const root = exerciseCatalogRoot(exercise)
  return catalog.filter((candidate) => candidate.source === 'system'
    && exerciseCatalogRoot(candidate) === root
    && !EXERCISE_PICKER_REPLACEMENTS[candidate.ref])
    .sort((a, b) => Number(b.ref === root) - Number(a.ref === root) || a.name.localeCompare(b.name, 'ru'))
}
