import { describe, expect, it } from 'vitest'

import {
  matchWorkoutExtraction,
  validateWorkoutExtraction,
  workoutExtractionPrompt,
  type WorkoutParserExercise,
} from './extracted-workout.js'

const catalog: WorkoutParserExercise[] = [
  { source: 'system', ref: 'lateral-dumbbell', name: 'Отведение гантелей в стороны', inputKind: 'strength', equipment: 'Гантели', muscleGroup: 'shoulders', primaryMuscleDetail: 'Средняя дельта' },
  { source: 'system', ref: 'lateral-transition', name: 'Отведение гантелей в стороны с переходом в подъём вперёд', inputKind: 'strength', equipment: 'Гантели', muscleGroup: 'shoulders', primaryMuscleDetail: 'Дельтовидные' },
  { source: 'system', ref: 'cable-lateral', name: 'Разведение рук в кроссовере стоя', inputKind: 'strength', equipment: 'Блок', muscleGroup: 'shoulders', primaryMuscleDetail: 'Средняя дельта' },
  { source: 'system', ref: 'rear-supported', name: 'Разводка гантелей на заднюю дельту с опорой головой', inputKind: 'strength', equipment: 'Гантели', muscleGroup: 'shoulders', primaryMuscleDetail: 'Задняя дельта' },
  { source: 'custom', ref: 'custom-1', name: 'Моя тяга с паузой', inputKind: 'strength' },
]

function extracted(items: Array<Record<string, unknown>>, unmatched: Array<Record<string, unknown>> = []) {
  return validateWorkoutExtraction({ items, unmatched })
}

describe('workout extraction without a catalog prompt', () => {
  it('does not include catalog data in the model prompt', () => {
    const prompt = workoutExtractionPrompt('Присед 3 по 10')
    expect(prompt).toContain('Текст: Присед 3 по 10')
    expect(prompt).not.toContain('Каталог:')
    expect(prompt).not.toContain('exerciseRef')
  })

  it('matches the reported shoulder phrases against the complete catalog', () => {
    const result = matchWorkoutExtraction(extracted([
      { sourceText: 'отведение стоя гантелями', exerciseName: 'отведение гантелей в стороны', equipment: 'гантели', muscle: 'средняя дельта', sets: [], position: 0 },
      { sourceText: 'отведение стоя в кроссовере', exerciseName: 'разведение рук в кроссовере стоя', equipment: 'блок', muscle: 'средняя дельта', sets: [], position: 1 },
      { sourceText: 'отведение сидя на скамье с упором', exerciseName: 'разводка гантелей на заднюю дельту с опорой головой', equipment: 'гантели', muscle: 'задняя дельта', sets: [], position: 2 },
    ]), catalog)

    expect(result.items.map((item) => item.exerciseRef)).toEqual(['lateral-dumbbell', 'cable-lateral', 'rear-supported'])
    expect(result.unmatched).toEqual([])
  })

  it('keeps values and matches a visible custom exercise', () => {
    const result = matchWorkoutExtraction(extracted([{
      sourceText: 'моя тяга с паузой 3 по 10 40 кг', exerciseName: 'Моя тяга с паузой', equipment: null, muscle: null,
      sets: [{ weightKg: 40, reps: 10 }, { weightKg: 40, reps: 10 }, { weightKg: 40, reps: 10 }], position: 0,
    }]), catalog)

    expect(result.items).toEqual([{
      sourceText: 'моя тяга с паузой 3 по 10 40 кг', exerciseRef: 'custom-1', confidence: 1,
      sets: [{ weightKg: 40, reps: 10 }, { weightKg: 40, reps: 10 }, { weightKg: 40, reps: 10 }], position: 0,
    }])
  })

  it('returns ambiguous suggestions instead of silently choosing a variant', () => {
    const result = matchWorkoutExtraction(extracted([{
      sourceText: 'отведение гантелей', exerciseName: 'отведение гантелей', equipment: 'гантели', muscle: null, sets: [{ reps: 10 }], position: 0,
    }]), catalog)

    expect(result.items).toEqual([])
    expect(result.unmatched[0]).toMatchObject({
      sourceText: 'отведение гантелей', reason: 'Нужно уточнить вариант упражнения', sets: [{ reps: 10 }], position: 0,
    })
    expect(result.unmatched[0]?.suggestedExerciseRefs).toContain('lateral-dumbbell')
  })

  it('tolerates a voice typo when the remaining words and equipment agree', () => {
    const result = matchWorkoutExtraction(extracted([{
      sourceText: 'разведение рук в кросовере стоя', exerciseName: 'разведение рук в кросовере стоя', equipment: 'блок', muscle: 'средняя дельта', sets: [], position: 0,
    }]), catalog)

    expect(result.items[0]?.exerciseRef).toBe('cable-lateral')
    expect(result.unmatched).toEqual([])
  })

  it('keeps two occurrences of the same exercise as separate ordered rows', () => {
    const result = matchWorkoutExtraction(extracted([
      { sourceText: 'моя тяга с паузой 10 раз', exerciseName: 'Моя тяга с паузой', equipment: null, muscle: null, sets: [{ reps: 10 }], position: 0 },
      { sourceText: 'моя тяга с паузой 8 раз', exerciseName: 'Моя тяга с паузой', equipment: null, muscle: null, sets: [{ reps: 8 }], position: 2 },
    ], [{ sourceText: 'круг', reason: 'Служебная структура', position: 1 }]), catalog)

    expect(result.items.map((item) => [item.exerciseRef, item.position, item.sets[0]?.reps])).toEqual([
      ['custom-1', 0, 10], ['custom-1', 2, 8],
    ])
    expect(result.unmatched[0]?.position).toBe(1)
  })

  it('preserves partial success and the original positions', () => {
    const result = matchWorkoutExtraction(extracted([
      { sourceText: 'моя тяга с паузой', exerciseName: 'Моя тяга с паузой', equipment: null, muscle: null, sets: [], position: 1 },
    ], [
      { sourceText: 'непонятное движение', reason: 'Не удалось выделить упражнение', position: 0 },
    ]), catalog)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.position).toBe(1)
    expect(result.unmatched).toEqual([{
      sourceText: 'непонятное движение', reason: 'Не удалось выделить упражнение', suggestedExerciseRefs: [], position: 0,
    }])
  })

  it('searches a production-sized catalog without adding it to the prompt', () => {
    const largeCatalog: WorkoutParserExercise[] = Array.from({ length: 1_165 }, (_, index) => ({
      source: 'system', ref: `exercise-${index}`, name: `Тестовое упражнение ${index}`, inputKind: 'strength',
    }))
    largeCatalog[1_164] = { source: 'system', ref: 'target', name: 'Разведение рук в кроссовере стоя', inputKind: 'strength', equipment: 'Блок', primaryMuscleDetail: 'Средняя дельта' }
    const result = matchWorkoutExtraction(extracted([{
      sourceText: 'отведение стоя в кроссовере', exerciseName: 'Разведение рук в кроссовере стоя', equipment: 'блок', muscle: 'средняя дельта', sets: [], position: 0,
    }]), largeCatalog)

    expect(result.items[0]?.exerciseRef).toBe('target')
    expect(Buffer.byteLength(workoutExtractionPrompt('отведение стоя в кроссовере'))).toBeLessThan(2_000)
  })

  it('rejects a model payload without any usable rows', () => {
    expect(() => validateWorkoutExtraction({ items: [{ sourceText: '', exerciseName: '', sets: [] }], unmatched: [] })).toThrow('invalid_output')
  })
})
