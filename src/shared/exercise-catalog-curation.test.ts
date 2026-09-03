import { describe, expect, it } from 'vitest'
import { EXERCISE_CATALOG_DECISIONS } from './exercise-catalog-decisions'
import { COMPATIBLE_EXERCISE_REPLACEMENTS, exerciseCatalogRoot, exerciseCatalogSection, exerciseCatalogVariants, groupCatalogResults, isCatalogRoot } from './exercise-catalog-curation'
import { SYSTEM_EXERCISE_CATALOG, SYSTEM_EXERCISE_LEGACY_CATALOG } from './system-exercises'
import { ORIGINAL_SEARCH_ALIASES, SEARCH_ALIASES, matchesExerciseSearch, normalizeExerciseSearch, resolveExerciseSearch } from '../features/exercises/exercise-search'
import { selectableExercises } from '../features/exercises/selectable-exercises'

const byRef = new Map(SYSTEM_EXERCISE_CATALOG.map((exercise) => [exercise.ref, exercise]))
const selectable = selectableExercises(SYSTEM_EXERCISE_CATALOG)

describe('approved catalog curation', () => {
  it('accounts for all approved rows, and preserves the later Smith addition', () => {
    expect(Object.keys(EXERCISE_CATALOG_DECISIONS)).toHaveLength(662)
    expect(SYSTEM_EXERCISE_CATALOG).toHaveLength(663)
    const roots = SYSTEM_EXERCISE_CATALOG.filter(isCatalogRoot)
    expect(['core', 'uncommon', 'rare', 'formats'].map((section) => roots.filter((exercise) => exerciseCatalogSection(exercise) === section).length)).toEqual([80, 279, 215, 7])
    expect(roots.find((exercise) => exercise.ref === 'smith-single-leg-romanian-deadlift')).toBeDefined()
    for (const [ref, decision] of Object.entries(EXERCISE_CATALOG_DECISIONS)) {
      expect(byRef.has(ref), ref).toBe(true)
      if (decision.target) {
        const target = byRef.get(decision.target)!
        expect(target, ref).toBeDefined()
        expect(isCatalogRoot(target), ref).toBe(true)
        expect(decision.target, ref).not.toBe(ref)
      }
    }
  })

  it('preserves every historical identifier, field, media link and instruction', () => {
    for (const original of SYSTEM_EXERCISE_LEGACY_CATALOG) {
      const current = byRef.get(original.ref)!
      expect({ ...current, name: original.name }, original.ref).toEqual(original)
    }
    expect(Object.keys(COMPATIBLE_EXERCISE_REPLACEMENTS)).toHaveLength(16)
    for (const [ref, target] of Object.entries(COMPATIBLE_EXERCISE_REPLACEMENTS)) {
      expect(byRef.get(ref)!.inputKind).toBe(byRef.get(target)!.inputKind)
      expect(selectable.some((exercise) => exercise.ref === ref)).toBe(false)
    }
  })

  it('keeps every non-identical variant selectable with its own fields', () => {
    for (const [ref, decision] of Object.entries(EXERCISE_CATALOG_DECISIONS)) {
      if (!decision.target || decision.action === 'format' || COMPATIBLE_EXERCISE_REPLACEMENTS[ref]) continue
      const exercise = byRef.get(ref)!
      expect(isCatalogRoot(exercise), ref).toBe(false)
      expect(exerciseCatalogVariants(byRef.get(decision.target)!, SYSTEM_EXERCISE_CATALOG), ref).toContain(exercise)
      expect(selectable, ref).toContain(exercise)
    }
    expect(COMPATIBLE_EXERCISE_REPLACEMENTS['fedb-parallel-bar-dip']).toBeUndefined()
    expect(COMPATIBLE_EXERCISE_REPLACEMENTS['fedb-external-rotation-with-band']).toBeUndefined()
  })

  it('preserves every old name, hand-reviewed synonym and slang phrase', () => {
    let checkedAliases = 0
    for (const original of SYSTEM_EXERCISE_LEGACY_CATALOG) {
      const target = byRef.get(COMPATIBLE_EXERCISE_REPLACEMENTS[original.ref] ?? original.ref)!
      const phrases = [original.name, original.name.replace(/\s*\([^)]*\)\s*$/, ''), ...(ORIGINAL_SEARCH_ALIASES[original.ref] ?? [])]
      const registered = new Set((SEARCH_ALIASES[target.ref] ?? []).map(normalizeExerciseSearch))
      for (const phrase of phrases) {
        expect(registered.has(normalizeExerciseSearch(phrase)), `${original.ref}: ${phrase}`).toBe(true)
        expect(matchesExerciseSearch(target, phrase), `${original.ref}: ${phrase}`).toBe(true)
        checkedAliases += 1
      }
      // English source aliases remain hints, not newly exact aliases.
      const english = original.ref.replace(/^(?:fedb|vital)-/u, '').replaceAll('-', ' ')
      expect(matchesExerciseSearch(target, english), original.ref).toBe(true)
      expect(selectable).toContain(target)
    }
    expect(checkedAliases).toBeGreaterThan(1500)
  })

  it('finds merged names and slang while retaining distinct equipment', () => {
    for (const [query, ref] of [['жим лёжа средним хватом', 'fedb-barbell-bench-press-medium-grip'], ['тяга гантели одной рукой', 'dumbbell-row'], ['гиперы', 'hyperextension']] as const) {
      const result = resolveExerciseSearch(selectable, query)
      expect(result.matches.some(({ exercise }) => exercise.ref === ref), query).toBe(true)
    }
    const machine = byRef.get('fedb-machine-shoulder-military-press')!
    const dumbbells = byRef.get('seated-dumbbell-press')!
    expect(exerciseCatalogRoot(machine)).not.toBe(exerciseCatalogRoot(dumbbells))
  })

  it('groups search hits by movement without hiding custom exercises or the matching variant', () => {
    const variant = SYSTEM_EXERCISE_CATALOG.find((exercise) => EXERCISE_CATALOG_DECISIONS[exercise.ref]?.action === 'variant')!
    const root = byRef.get(exerciseCatalogRoot(variant))!
    const custom = { ...variant, source: 'custom' as const, customExerciseId: 'custom' }
    expect(groupCatalogResults([variant, root, custom])).toEqual([variant, custom])
    expect(exerciseCatalogVariants(custom, SYSTEM_EXERCISE_CATALOG)).toEqual([])
  })
})
