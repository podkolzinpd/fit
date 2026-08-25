import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { exercisesRepository } from '../../data/repositories/exercises.repository'
import { formatLlmWorkoutText, mergeWorkoutParse, parseWorkoutWithLlm, requireExerciseConfirmation } from './llm-workout-parser'

const catalog: ExerciseSnapshot[] = [
  { source: 'system', ref: 'bench', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength' },
]

describe('formatLlmWorkoutText', () => {
  afterEach(() => vi.restoreAllMocks())

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

  it('восстанавливает weight-first значения, которые модель пропустила', () => {
    expect(mergeWorkoutParse({
      items: [{ sourceText: 'Становая с гантелями 20кг 3 по 15', exerciseRef: 'deadlift', confidence: 0.8, sets: [] }],
      unmatched: [{ sourceText: 'Гиперэкстензия с блином 10 кг 3 по 10', reason: 'Не найдено', suggestedExerciseRefs: [] }],
    }, {
      items: [
        { sourceText: 'Становая с гантелями 20кг 3 по 15', exerciseRef: 'dumbbell-deadlift', confidence: 1, sets: Array.from({ length: 3 }, () => ({ weightKg: 20, reps: 15 })) },
        { sourceText: 'Гиперэкстензия с блином 10 кг 3 по 10', exerciseRef: 'hyperextension', confidence: 1, sets: Array.from({ length: 3 }, () => ({ weightKg: 10, reps: 10 })) },
      ],
      unmatched: [],
    })).toEqual({
      items: [
        { sourceText: 'Становая с гантелями 20кг 3 по 15', exerciseRef: 'dumbbell-deadlift', confidence: 1, sets: Array.from({ length: 3 }, () => ({ weightKg: 20, reps: 15 })) },
        { sourceText: 'Гиперэкстензия с блином 10 кг 3 по 10', exerciseRef: 'hyperextension', confidence: 1, sets: Array.from({ length: 3 }, () => ({ weightKg: 10, reps: 10 })) },
      ],
      unmatched: [],
    })
  })

  it('сохраняет уточнение для действительно неоднозначной строки', () => {
    expect(mergeWorkoutParse({ items: [], unmatched: [] }, {
      items: [],
      unmatched: [{ sourceText: 'Сведение и разведение ног 20 кг 3 по 20', reason: 'Нужно уточнить вариант упражнения', suggestedExerciseRefs: ['adductor', 'abductor'] }],
    })).toEqual({
      items: [],
      unmatched: [{ sourceText: 'Сведение и разведение ног 20 кг 3 по 20', reason: 'Нужно уточнить вариант упражнения', suggestedExerciseRefs: ['adductor', 'abductor'] }],
    })
  })

  it('не подставляет упражнение из модели с недостаточной уверенностью', () => {
    const choices: ExerciseSnapshot[] = [
      { source: 'system', ref: 'barbell-bench', name: 'Жим штанги лёжа', muscleGroup: 'chest', inputKind: 'strength' },
      { source: 'system', ref: 'dumbbell-bench', name: 'Жим гантелей лёжа', muscleGroup: 'chest', inputKind: 'strength' },
    ]
    expect(requireExerciseConfirmation({
      items: [{ sourceText: 'жим лёжа 3 по 10', exerciseRef: 'barbell-bench', confidence: 0.96, sets: [{ weightKg: 50, reps: 10 }] }], unmatched: [],
    }, choices)).toEqual({
      items: [],
      unmatched: [{ sourceText: 'жим лёжа 3 по 10', reason: 'Нужно выбрать упражнение: модель не уверена в совпадении', suggestedExerciseRefs: ['barbell-bench', 'dumbbell-bench'] }],
    })
  })

  it('не принимает от модели штангу, когда пользователь явно назвал гантели', () => {
    const equipmentCatalog: ExerciseSnapshot[] = [
      { source: 'system', ref: 'incline-barbell', name: 'Жим на наклонной (Штанга)', muscleGroup: 'chest', inputKind: 'strength', equipment: 'Штанга', equipmentRef: 'barbell' },
      { source: 'system', ref: 'incline-dumbbell', name: 'Жим гантелей на наклонной (Гантели)', muscleGroup: 'chest', inputKind: 'strength', equipment: 'Гантели', equipmentRef: 'dumbbell' },
    ]

    expect(mergeWorkoutParse({
      items: [{ sourceText: 'Жим гантелей на наклонной скамье 3 по 10 70 кг', exerciseRef: 'incline-barbell', confidence: 0.95, sets: [{ weightKg: 70, reps: 10 }] }],
      unmatched: [],
    }, { items: [], unmatched: [] }, equipmentCatalog)).toEqual({
      items: [],
      unmatched: [{
        sourceText: 'Жим гантелей на наклонной скамье 3 по 10 70 кг',
        reason: 'Нужно уточнить оборудование',
        suggestedExerciseRefs: ['incline-dumbbell'],
      }],
    })
  })

  it('не теряет безопасно найденное упражнение при временной ошибке LLM', async () => {
    vi.spyOn(exercisesRepository, 'parseWorkout').mockRejectedValue(new Error('network'))
    const localCatalog: ExerciseSnapshot[] = [
      { source: 'system', ref: 'dumbbell-deadlift', name: 'Становая с гантелями', muscleGroup: 'legs', inputKind: 'strength' },
    ]

    await expect(parseWorkoutWithLlm('Становая с гантелями 20 кг 3 по 15', localCatalog)).resolves.toEqual({
      items: [{
        sourceText: 'Становая с гантелями 20 кг 3 по 15',
        exerciseRef: 'dumbbell-deadlift',
        confidence: 1,
        sets: Array.from({ length: 3 }, () => ({ weightKg: 20, reps: 15 })),
      }],
      unmatched: [],
    })
  })

  it('передаёт связку сведения и разведения в LLM как два упражнения без дублей', async () => {
    const parse = vi.spyOn(exercisesRepository, 'parseWorkout').mockResolvedValue({ items: [], unmatched: [] })
    const localCatalog: ExerciseSnapshot[] = [
      { source: 'system', ref: 'fedb-thigh-adductor', name: 'Сведение ног (Тренажёр)', muscleGroup: 'legs', inputKind: 'strength' },
      { source: 'system', ref: 'fedb-thigh-abductor', name: 'Разведение ног (Тренажёр)', muscleGroup: 'legs', inputKind: 'strength' },
    ]

    const result = await parseWorkoutWithLlm('Сведение и разведение ног 20 кг 3 по 20', localCatalog)

    expect(parse).toHaveBeenCalledWith(
      'Сведение ног 20 кг 3 по 20\nРазведение ног 20 кг 3 по 20',
      localCatalog,
    )
    expect(result.items.map((item) => item.exerciseRef)).toEqual(['fedb-thigh-adductor', 'fedb-thigh-abductor'])
    expect(result.items.every((item) => item.sets.length === 3)).toBe(true)
  })

  it('передаёт модели очищенную копию диктовки и сохраняет локальные числа словами', async () => {
    const parse = vi.spyOn(exercisesRepository, 'parseWorkout').mockResolvedValue({ items: [], unmatched: [] })
    const localCatalog: ExerciseSnapshot[] = [
      { source: 'system', ref: 'bench', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength' },
    ]

    const result = await parseWorkoutWithLlm('Ну, эээ, жим лёжа три по десять восемьдесят килограмм', localCatalog)

    expect(parse).toHaveBeenCalledWith('жим лёжа три по десять восемьдесят килограмм', localCatalog)
    expect(result.items[0]).toMatchObject({
      exerciseRef: 'bench',
      sets: Array.from({ length: 3 }, () => ({ weightKg: 80, reps: 10 })),
    })
  })
})
