import { describe, expect, it } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'
import { SYSTEM_EXERCISE_PICKER_REPLACEMENTS, selectableExercises } from './selectable-exercises'
import { RETIRED_SYSTEM_EXERCISE_REFS } from '../../shared/exercise-catalog-retirement'
import { exerciseCatalogSection, isCatalogRoot } from '../../shared/exercise-catalog-curation'
import { programWorkoutDrafts } from '../assistant/program-draft'
import { parseQuickWorkoutEntry } from '../workouts/quick-workout-entry'
import { resolveExerciseSearch } from './exercise-search'

describe('selectable exercise catalog', () => {
  const retained = ['fedb-standing-bradford-press', 'fedb-bradford-rocky-presses', 'fedb-anti-gravity-press', 'fedb-double-kettlebell-windmill']

  it('retires exactly 83 roots without losing any historical ref or the four used exercises', () => {
    const selectable = selectableExercises(SYSTEM_EXERCISE_CATALOG)
    expect(RETIRED_SYSTEM_EXERCISE_REFS.size).toBe(83)
    expect(SYSTEM_EXERCISE_CATALOG).toHaveLength(663)
    expect(selectable).toHaveLength(663 - 16 - 83)
    for (const ref of RETIRED_SYSTEM_EXERCISE_REFS) {
      const historic = SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === ref)!
      expect(historic, ref).toBeDefined()
      expect(isCatalogRoot(historic), ref).toBe(true)
      expect(selectable, ref).not.toContain(historic)
      // A custom exercise must remain available even with the exact same ref/name.
      const custom = { ...historic, source: 'custom' as const, customExerciseId: 'custom' }
      expect(selectableExercises([custom])).toEqual([custom])
      expect(resolveExerciseSearch(selectable, historic.name).matches.some(({ exercise }) => RETIRED_SYSTEM_EXERCISE_REFS.has(exercise.ref))).toBe(false)
    }
    for (const ref of retained) expect(selectable.some((exercise) => exercise.ref === ref), ref).toBe(true)
    const roots = selectable.filter(isCatalogRoot)
    expect(['core', 'uncommon', 'rare', 'formats'].map((section) => roots.filter((exercise) => exerciseCatalogSection(exercise) === section).length)).toEqual([80, 274, 137, 7])
  })

  it('does not recreate retired refs through typed workouts or an explicit AI program ref', () => {
    const exercise = SYSTEM_EXERCISE_CATALOG.find((item) => item.ref === 'fedb-atlas-stones')!
    const result = parseQuickWorkoutEntry(exercise.name + ' 3 по 10', SYSTEM_EXERCISE_CATALOG)
    expect(result.parsed.some((item) => RETIRED_SYSTEM_EXERCISE_REFS.has(item.exercise.ref))).toBe(false)
    expect(programWorkoutDrafts('client', [{ title: 'План', day: 'пн', exercises: [{ name: exercise.name, exerciseRef: exercise.ref, sets: 1 }] }], ['2026-09-10'], ['request'], [exercise])).toBeUndefined()
    const custom = { ...exercise, source: 'custom' as const, customExerciseId: 'custom' }
    expect(programWorkoutDrafts('client', [{ title: 'План', day: 'пн', exercises: [{ name: custom.name, exerciseRef: custom.ref, sets: 1 }] }], ['2026-09-10'], ['request'], [custom])?.[0]?.exercises[0]?.source).toBe('custom')
  })

  it('hides only known system duplicates from a new choice and keeps every historical ref resolvable', () => {
    const selectable = selectableExercises(SYSTEM_EXERCISE_CATALOG)

    for (const [hiddenRef, canonicalRef] of Object.entries(SYSTEM_EXERCISE_PICKER_REPLACEMENTS)) {
      expect(SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === hiddenRef)).toBeDefined()
      expect(SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === canonicalRef)).toBeDefined()
      expect(selectable.find((exercise) => exercise.ref === hiddenRef)).toBeUndefined()
      expect(selectable.find((exercise) => exercise.ref === canonicalRef)).toBeDefined()
    }
  })

  it('never hides or merges trainer-created exercises even when their ref or name matches a system duplicate', () => {
    const customByName: ExerciseSnapshot = {
      source: 'custom', ref: 'custom-row', customExerciseId: 'custom-row',
      name: 'Тяга штанги в наклоне (Штанга)', muscleGroup: 'back', inputKind: 'strength',
    }
    const customByRef: ExerciseSnapshot = {
      source: 'custom', ref: 'fedb-bent-over-barbell-row', customExerciseId: 'custom-same-ref',
      name: 'Моя тяга', muscleGroup: 'back', inputKind: 'strength',
    }

    expect(selectableExercises([
      SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === 'fedb-bent-over-barbell-row')!,
      customByName,
      customByRef,
    ])).toEqual([customByName, customByRef])
  })
})
