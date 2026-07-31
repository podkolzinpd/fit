import { describe, expect, it } from 'vitest'
import { parseQuickWorkoutEntry } from './quick-workout-entry'
import type { ExerciseSnapshot } from '../../shared/domain'
import { SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'

const catalog: ExerciseSnapshot[] = [
  { source: 'system', ref: 'squat', name: 'Присед со штангой', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'bench', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration' },
  { source: 'system', ref: 'running', name: 'Бег', muscleGroup: 'cardio', inputKind: 'distance' },
]

describe('parseQuickWorkoutEntry', () => {
  it('разбирает силовое упражнение с количеством подходов, повторами и весом', () => {
    const result = parseQuickWorkoutEntry('Присед со штангой 3×8 80 кг', catalog)
    expect(result.unparsed).toEqual([])
    expect(result.parsed[0]).toMatchObject({ exercise: { ref: 'squat' }, hasValues: true })
    expect(result.parsed[0]?.sets).toEqual([
      { position: 0, weightKg: 80, reps: 8 },
      { position: 1, weightKg: 80, reps: 8 },
      { position: 2, weightKg: 80, reps: 8 },
    ])
  })

  it('разбирает время в секундах и дистанцию в км', () => {
    const result = parseQuickWorkoutEntry('Планка 3×45 сек\nБег 30 мин 5 км', catalog)
    expect(result.parsed[0]?.sets).toEqual([
      { position: 0, durationSec: 45 },
      { position: 1, durationSec: 45 },
      { position: 2, durationSec: 45 },
    ])
    expect(result.parsed[1]?.sets).toEqual([{ position: 0, durationSec: 1800, distanceKm: 5 }])
  })

  it('понимает привычные форматы веса, подходов и RPE', () => {
    const result = parseQuickWorkoutEntry('Присед со штангой 80×8×3 RPE 8\nЖим лёжа 3 подхода по 10 60 кг RPE 7.5', catalog)
    expect(result.unparsed).toEqual([])
    expect(result.parsed[0]?.sets).toEqual([
      { position: 0, weightKg: 80, reps: 8, rpe: 8 },
      { position: 1, weightKg: 80, reps: 8, rpe: 8 },
      { position: 2, weightKg: 80, reps: 8, rpe: 8 },
    ])
    expect(result.parsed[1]?.sets).toEqual([
      { position: 0, weightKg: 60, reps: 10, rpe: 7.5 },
      { position: 1, weightKg: 60, reps: 10, rpe: 7.5 },
      { position: 2, weightKg: 60, reps: 10, rpe: 7.5 },
    ])
  })

  it('применяет запись «по» к упражнению на время', () => {
    const result = parseQuickWorkoutEntry('Планка 3 по 45 сек RPE 8', catalog)
    expect(result.parsed[0]?.sets).toEqual([
      { position: 0, durationSec: 45, rpe: 8 },
      { position: 1, durationSec: 45, rpe: 8 },
      { position: 2, durationSec: 45, rpe: 8 },
    ])
  })

  it('сохраняет разные веса и повторы из списка подходов', () => {
    const result = parseQuickWorkoutEntry('Присед со штангой 80×8, 85 кг × 6, 90 на 5 RPE 8.5', catalog)
    expect(result.unparsed).toEqual([])
    expect(result.parsed[0]?.sets).toEqual([
      { position: 0, weightKg: 80, reps: 8, rpe: 8.5 },
      { position: 1, weightKg: 85, reps: 6, rpe: 8.5 },
      { position: 2, weightKg: 90, reps: 5, rpe: 8.5 },
    ])
  })

  it('разделяет упражнения из голосовой фразы и понимает «вес на повторы»', () => {
    const result = parseQuickWorkoutEntry('Присед со штангой 80 на 8, 85 на 6 затем Планка 3 по 45 сек', catalog)
    expect(result.unparsed).toEqual([])
    expect(result.parsed.map((item) => item.exercise.ref)).toEqual(['squat', 'plank'])
    expect(result.parsed[0]?.sets).toEqual([
      { position: 0, weightKg: 80, reps: 8 },
      { position: 1, weightKg: 85, reps: 6 },
    ])
    expect(result.parsed[1]?.sets).toEqual([
      { position: 0, durationSec: 45 },
      { position: 1, durationSec: 45 },
      { position: 2, durationSec: 45 },
    ])
  })

  it('не выбирает упражнение молча, если название неоднозначно или не найдено', () => {
    const result = parseQuickWorkoutEntry('Присед 3×8 80 кг\nНесуществующее 3×10', catalog)
    expect(result.parsed).toEqual([])
    expect(result.unparsed[0]).toMatchObject({ line: 'Присед 3×8 80 кг', reason: 'ambiguous', candidates: [{ ref: 'squat' }] })
    expect(result.unparsed[1]).toEqual({ line: 'Несуществующее 3×10', reason: 'not-found', candidates: [] })
  })

  it('предпочитает системное упражнение одноимённому пользовательскому', () => {
    const result = parseQuickWorkoutEntry('Планка 45 сек', [...catalog, {
      source: 'custom', ref: 'custom-plank', customExerciseId: 'custom-plank', name: 'Планка', muscleGroup: 'core', inputKind: 'strength',
    }])
    expect(result.parsed[0]?.exercise.ref).toBe('plank')
  })

  it('находит примеры подсказки в полном каталоге', () => {
    const result = parseQuickWorkoutEntry('Присед со штангой 3×8 80 кг\nПланка 3×45 сек', SYSTEM_EXERCISE_CATALOG)
    expect(result.unparsed).toEqual([])
    expect(result.parsed.map((item) => item.exercise.ref)).toEqual(['barbell-squat', 'plank'])
  })
})
