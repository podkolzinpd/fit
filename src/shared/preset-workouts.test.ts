import { describe, expect, it } from 'vitest'
import { PRESET_WORKOUTS, presetWorkoutToParsedItems } from './preset-workouts'
import { SYSTEM_EXERCISE_CATALOG } from './system-exercises'
import { isActiveCatalogExercise } from './exercise-catalog-retirement'
import type { ExerciseSnapshot } from './domain'

const allRefs = PRESET_WORKOUTS.flatMap((preset) => preset.exercises.map((exercise) => ({ presetId: preset.id, ref: exercise.ref })))

describe('preset workouts catalog contract', () => {
  it('contains unique preset ids', () => {
    expect(new Set(PRESET_WORKOUTS.map((preset) => preset.id)).size).toBe(PRESET_WORKOUTS.length)
  })

  it('has at least one exercise per preset', () => {
    for (const preset of PRESET_WORKOUTS) expect(preset.exercises.length).toBeGreaterThan(0)
  })

  it.each(allRefs)('$presetId: $ref matches the active system catalog', ({ ref }) => {
    const canonical = SYSTEM_EXERCISE_CATALOG.find((row) => row.ref === ref)
    expect(canonical).toBeDefined()
    expect(isActiveCatalogExercise(canonical!)).toBe(true)
  })

  // Каталог упражнений — общий, живой источник: ref может со временем стать
  // указывать на другой вариант того же упражнения (например, со штангой
  // вместо своего веса). Для пресетов, которые прямо обещают «без инвентаря»,
  // это меняет реальный смысл тренировки, хотя ref остаётся валидным и
  // активным — поэтому проверяем оборудование отдельно.
  const noEquipmentPresetIds = ['full-body-no-equipment', 'core-basics']
  const noEquipmentTags = ['Без оборудования', 'Своё тело']
  it.each(
    PRESET_WORKOUTS
      .filter((preset) => noEquipmentPresetIds.includes(preset.id))
      .flatMap((preset) => preset.exercises.map((exercise) => ({ presetId: preset.id, ref: exercise.ref }))),
  )('$presetId: $ref requires no equipment', ({ ref }) => {
    const canonical = SYSTEM_EXERCISE_CATALOG.find((row) => row.ref === ref)
    expect(canonical?.equipment === undefined || noEquipmentTags.includes(canonical.equipment)).toBe(true)
  })
})

describe('presetWorkoutToParsedItems', () => {
  const preset = PRESET_WORKOUTS.find((item) => item.id === 'full-body-no-equipment')
  if (!preset) throw new Error('expected the full-body-no-equipment preset to exist')

  it('maps every exercise to a parsed item with positioned sets', () => {
    const items = presetWorkoutToParsedItems(preset, SYSTEM_EXERCISE_CATALOG)
    expect(items).toHaveLength(preset.exercises.length)
    items.forEach((item, index) => {
      expect(item.exercise.ref).toBe(preset.exercises[index]?.ref)
      expect(item.hasValues).toBe(true)
      item.sets.forEach((set, position) => expect(set.position).toBe(position))
    })
  })

  it('throws when a preset references an exercise missing from the catalog', () => {
    const emptyCatalog: ExerciseSnapshot[] = []
    expect(() => presetWorkoutToParsedItems(preset, emptyCatalog)).toThrow(/unknown exercise ref/)
  })
})
