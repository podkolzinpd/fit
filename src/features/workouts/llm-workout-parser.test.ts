import { describe, expect, it } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { formatLlmWorkoutText } from './llm-workout-parser'

const catalog: ExerciseSnapshot[] = [
  { source: 'system', ref: 'bench', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength' },
]

describe('formatLlmWorkoutText', () => {
  it('оставляет каждый результат отдельной строкой и не теряет неизвестный фрагмент', () => {
    expect(formatLlmWorkoutText({
      items: [{ sourceText: 'жим лёжа', exerciseRef: 'bench', confidence: 0.98, sets: [{ weightKg: 100, reps: 12 }, { weightKg: 100, reps: 12 }]}],
      unmatched: [{ sourceText: 'новое движение 3 по 10', reason: 'Не найдено', suggestedExerciseRefs: [] }],
    }, catalog)).toBe('Жим лёжа — 2 × 12 повт. × 100 кг\nновое движение 3 по 10')
  })

  it('не выводит нулевые время и дистанцию у силового упражнения', () => {
    expect(formatLlmWorkoutText({
      items: [{ sourceText: 'жим лёжа', exerciseRef: 'bench', confidence: 0.98, sets: [{ weightKg: 100, reps: 15, durationMin: 0, distanceKm: 0 }]}],
      unmatched: [],
    }, catalog)).toBe('Жим лёжа — 1 × 15 повт. × 100 кг')
  })
})
