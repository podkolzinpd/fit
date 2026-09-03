import type { ExerciseSnapshot } from './domain'
import { EXERCISE_CATALOG_DECISIONS } from './exercise-catalog-decisions'
import { SYSTEM_EXERCISE_CATALOG } from './system-exercises'

const byRef = new Map(SYSTEM_EXERCISE_CATALOG.map((exercise) => [exercise.ref, exercise]))

// Same movement is not enough: converting reps/time to weight+reps would lose
// data. Such aliases become explicit variants instead of silent replacements.
export const COMPATIBLE_EXERCISE_REPLACEMENTS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EXERCISE_CATALOG_DECISIONS).flatMap(([ref, decision]) =>
    decision.action === 'duplicate' && decision.target && byRef.get(ref)?.inputKind === byRef.get(decision.target)?.inputKind
      ? [[ref, decision.target]] : []),
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
    && !COMPATIBLE_EXERCISE_REPLACEMENTS[candidate.ref])
    .sort((a, b) => Number(b.ref === root) - Number(a.ref === root) || a.name.localeCompare(b.name, 'ru'))
}
