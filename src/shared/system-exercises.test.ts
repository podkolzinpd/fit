import { describe, expect, it } from 'vitest'
import { SYSTEM_EXERCISES, SYSTEM_EXERCISE_CATALOG, SYSTEM_EXERCISE_CATALOG_VERSION } from './system-exercises'
import { IMPORTED_EXERCISES } from './system-exercises.generated'
import { BASE_EXERCISES } from './system-exercises.base.generated'

describe('system exercise catalog', () => {
  it('matches the V1 baseline catalog', () => {
    expect(SYSTEM_EXERCISE_CATALOG_VERSION).toBe(1)
    expect(SYSTEM_EXERCISES).toHaveLength(49)
    expect(new Set(SYSTEM_EXERCISES.map((exercise) => exercise.ref)).size).toBe(49)
    expect(new Set(SYSTEM_EXERCISES.map((exercise) => exercise.name)).size).toBe(49)
  })

  it('preserves the V1 category distribution', () => {
    const count = (group: string) => SYSTEM_EXERCISES.filter((exercise) => exercise.muscleGroup === group).length
    expect({
      legs: count('legs'), chest: count('chest'), back: count('back'),
      shoulders: count('shoulders'), arms: count('arms'), core: count('core'), cardio: count('cardio'),
    }).toEqual({ legs: 11, chest: 7, back: 7, shoulders: 6, arms: 6, core: 5, cardio: 7 })
  })

  it('keeps the cardio input semantics', () => {
    expect(SYSTEM_EXERCISES.filter((exercise) => exercise.inputKind === 'distance')).toHaveLength(5)
    // reps = ввод по времени (мин + повторы): изометрия на время (планки) + кардио.
    expect(SYSTEM_EXERCISES.filter((exercise) => exercise.inputKind === 'reps').map((exercise) => exercise.name))
      .toEqual(['Планка', 'Боковая планка', 'Прыжки со скакалкой', 'Берпи'])
  })

  it('добавляет импортированный каталог поверх базового без дублей', () => {
    // Полный каталог = 49 базовых + импортированные, ref уникальны.
    expect(SYSTEM_EXERCISE_CATALOG.length).toBe(SYSTEM_EXERCISES.length + IMPORTED_EXERCISES.length)
    expect(new Set(SYSTEM_EXERCISE_CATALOG.map((exercise) => exercise.ref)).size).toBe(SYSTEM_EXERCISE_CATALOG.length)
  })

  it('импортированные упражнения имеют метаданные каталога', () => {
    expect(IMPORTED_EXERCISES.length).toBeGreaterThanOrEqual(100)
    for (const exercise of IMPORTED_EXERCISES) {
      expect(exercise.source).toBe('system')
      expect(exercise.ref).toMatch(/^fedb-/)
      expect(exercise.equipment).toBeTruthy()
      expect(exercise.primaryMuscleDetail).toBeTruthy()
      expect(exercise.imageUrl).toMatch(/^\/exercises\/fedb-.+\.jpg$/)
    }
  })

  it('импортированные названия переведены на русский в формате «Упражнение (Оборудование)»', () => {
    for (const exercise of IMPORTED_EXERCISES) {
      // Нет латиницы (кроме допустимых аббревиатур в скобках нет) и есть «(…)».
      expect(exercise.name).not.toMatch(/[A-Za-z]/)
      expect(exercise.name).toMatch(/\([^)]+\)$/)
    }
    // Названия уникальны.
    expect(new Set(IMPORTED_EXERCISES.map((exercise) => exercise.name)).size).toBe(IMPORTED_EXERCISES.length)
  })

  it('базовые упражнения обогащены до идеального формата', () => {
    // Обогащённых базовых столько же, сколько рукописных, ref совпадают.
    expect(BASE_EXERCISES.length).toBe(SYSTEM_EXERCISES.length)
    expect(new Set(BASE_EXERCISES.map((exercise) => exercise.ref)))
      .toEqual(new Set(SYSTEM_EXERCISES.map((exercise) => exercise.ref)))
    for (const exercise of BASE_EXERCISES) {
      expect(exercise.name).toMatch(/\([^)]+\)$/)  // «Название (Оборудование)»
      expect(exercise.equipment).toBeTruthy()
      expect(exercise.primaryMuscleDetail).toBeTruthy()
    }
    // Большинство базовых получили картинку (кардио-тренажёры/берпи — без).
    expect(BASE_EXERCISES.filter((exercise) => exercise.imageUrl).length).toBeGreaterThanOrEqual(40)
  })

  it('каталог = обогащённые базовые + импортированные без дублей', () => {
    expect(SYSTEM_EXERCISE_CATALOG.length).toBe(BASE_EXERCISES.length + IMPORTED_EXERCISES.length)
    expect(new Set(SYSTEM_EXERCISE_CATALOG.map((exercise) => exercise.ref)).size).toBe(SYSTEM_EXERCISE_CATALOG.length)
  })

  it('инструкции группы «Ноги» переведены на русский', () => {
    const legs = SYSTEM_EXERCISE_CATALOG.filter((exercise) => exercise.muscleGroup === 'legs')
    expect(legs.length).toBeGreaterThan(0)
    for (const exercise of legs) {
      expect(exercise.instructions?.length).toBeGreaterThan(0)
      // Нет длинных латинских слов (остатков английского) в шагах техники.
      for (const step of exercise.instructions ?? []) expect(step).not.toMatch(/[A-Za-z]{4,}/)
    }
  })
})
