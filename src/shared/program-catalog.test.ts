import { describe, expect, it } from 'vitest'
import { PROGRAM_CATALOG } from '../../services/api/src/assistant-orchestrator/program/catalog'
import { SYSTEM_EXERCISE_CATALOG } from './system-exercises'
import { isActiveCatalogExercise } from './exercise-catalog-retirement'

describe('program catalog source contract', () => {
  it('contains unique stable exercise references', () => {
    expect(new Set(PROGRAM_CATALOG.map((row) => row.ref)).size).toBe(PROGRAM_CATALOG.length)
  })
  it.each(PROGRAM_CATALOG)('$ref matches the active application catalog', (item) => {
    const canonical = SYSTEM_EXERCISE_CATALOG.find((row) => row.ref === item.ref)
    expect(canonical).toBeDefined()
    expect(isActiveCatalogExercise(canonical!)).toBe(true)
    expect(item).toMatchObject({ name: canonical!.name, muscleGroup: canonical!.muscleGroup, inputKind: canonical!.inputKind })
  })
})
