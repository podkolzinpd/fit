import { describe, expect, it } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'
import { SYSTEM_EXERCISE_PICKER_REPLACEMENTS, selectableExercises } from './selectable-exercises'

describe('selectable exercise catalog', () => {
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
