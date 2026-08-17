import { describe, expect, it } from 'vitest'
import { formatWorkoutText, parseQuickWorkoutEntry, splitWorkoutText, workoutCandidates } from './quick-workout-entry'
import { rankExerciseSearch } from '../exercises/exercise-search'
import type { ExerciseSnapshot } from '../../shared/domain'
import { SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'

const catalog: ExerciseSnapshot[] = [
  { source: 'system', ref: 'squat', name: 'Присед со штангой', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'bench', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration' },
  { source: 'system', ref: 'running', name: 'Бег', muscleGroup: 'cardio', inputKind: 'distance' },
]

describe('parseQuickWorkoutEntry', () => {
  it('не съедает пробел, который тренер только что набрал в поле ввода', () => {
    expect(formatWorkoutText('Жим лёжа ', SYSTEM_EXERCISE_CATALOG)).toBe('Жим лёжа ')
  })

  it('понимает разговорное «гребля» как гребной тренажёр', () => {
    const result = parseQuickWorkoutEntry('Гребля 10 мин 2 км', SYSTEM_EXERCISE_CATALOG)

    expect(result.unparsed).toEqual([])
    expect(result.parsed[0]).toMatchObject({ exercise: { ref: 'rowing-machine' }, hasValues: true })
    expect(result.parsed[0]?.sets[0]).toMatchObject({ durationSec: 600, distanceKm: 2 })
  })

  it('автоматически выбирает базовый вариант, когда короткая фраза не содержит специальный хват', () => {
    const result = parseQuickWorkoutEntry('Жим гантелей на наклон 3×8 24 кг', SYSTEM_EXERCISE_CATALOG)

    expect(result.unparsed).toEqual([])
    expect(result.parsed[0]).toMatchObject({ exercise: { ref: 'fedb-incline-dumbbell-press' } })
    expect(result.parsed[0]?.sets).toHaveLength(3)
  })

  it('понимает разговорные названия тренажёров и не смешивает их с похожими движениями', () => {
    const cases = [
      ['хак присед 3×10 80 кг', 'fedb-hack-squat'],
      ['тяга к лицу 3×15', 'fedb-face-pull'],
      ['ягодичный мост со штангой 4×10 70 кг', 'fedb-barbell-hip-thrust'],
    ] as const

    for (const [text, ref] of cases) {
      const result = parseQuickWorkoutEntry(text, SYSTEM_EXERCISE_CATALOG)
      expect(result.unparsed, text).toEqual([])
      expect(result.parsed[0]?.exercise.ref, text).toBe(ref)
    }
  })

  it('понимает транслит, английские термины и сокращения тренера', () => {
    const cases = [
      ['smith squat 3×8 80 kg', 'fedb-smith-machine-squat'],
      ['face pull 3×15', 'fedb-face-pull'],
      ['hip thrust 3×8 80 kg', 'fedb-barbell-hip-thrust'],
      ['t-bar row 3×10 40 kg', 'fedb-bent-over-two-arm-long-bar-row'],
      ['db incline press 3×8 24 kg', 'fedb-incline-dumbbell-press'],
    ] as const

    for (const [text, ref] of cases) {
      const result = parseQuickWorkoutEntry(text, SYSTEM_EXERCISE_CATALOG)
      expect(result.unparsed, text).toEqual([])
      expect(result.parsed[0]?.exercise.ref, text).toBe(ref)
    }
  })

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

  it('покрывает обязательные короткие фразы бегового ввода', () => {
    const continuous = parseQuickWorkoutEntry('бег 30 минут 5 км', catalog)
    expect(continuous.unparsed).toEqual([])
    expect(continuous.parsed[0]).toMatchObject({
      exercise: { ref: 'running' },
      sets: [{ position: 0, durationSec: 1800, distanceKm: 5 }],
    })

    const intervals = parseQuickWorkoutEntry('6 по 400 метров', catalog)
    expect(intervals.unparsed).toEqual([])
    expect(intervals.parsed[0]).toMatchObject({
      exercise: { ref: 'running', name: 'Бег — интервалы' },
      structure: { blockPreset: 'interval', restBetweenSetsSec: 90 },
    })
    expect(intervals.parsed[0]?.sets).toEqual(Array.from({ length: 6 }, (_, position) => ({ position, distanceKm: 0.4 })))

    const timedSegment = parseQuickWorkoutEntry('400 метров за 1:40', catalog)
    expect(timedSegment.unparsed).toEqual([])
    expect(timedSegment.parsed[0]).toMatchObject({
      exercise: { ref: 'running' },
      sets: [{ position: 0, durationSec: 100, distanceKm: 0.4 }],
    })

    const recovery = parseQuickWorkoutEntry('между интервалами 200 метров трусцой', catalog)
    expect(recovery.unparsed).toEqual([])
    expect(recovery.parsed[0]).toMatchObject({
      exercise: { ref: 'running', name: 'Бег — восстановление' },
      sets: [{ position: 0, distanceKm: 0.2 }],
    })

    const mixed = parseQuickWorkoutEntry('400 метров + 10 берпи', SYSTEM_EXERCISE_CATALOG)
    expect(mixed.unparsed).toEqual([])
    expect(mixed.parsed.map((item) => item.exercise.ref)).toEqual(['running', 'burpees'])
    expect(mixed.parsed[0]?.sets).toEqual([{ position: 0, distanceKm: 0.4 }])
    expect(mixed.parsed[1]?.sets).toEqual([{ position: 0, reps: 10 }])

    const activeRecovery = parseQuickWorkoutEntry(
      '6 по 400 метров за 1:40, между интервалами 200 метров трусцой',
      catalog,
    )
    expect(activeRecovery.unparsed).toEqual([])
    expect(activeRecovery.parsed.map((item) => item.exercise.name)).toEqual([
      'Бег — быстрый отрезок',
      'Бег — восстановление',
    ])
    expect(activeRecovery.parsed[0]?.sets).toEqual(Array.from({ length: 6 }, (_, position) => ({ position, durationSec: 100, distanceKm: 0.4 })))
    expect(activeRecovery.parsed[1]?.sets).toEqual(Array.from({ length: 6 }, (_, position) => ({ position, distanceKm: 0.2 })))
    expect(activeRecovery.parsed[0]?.structure).toMatchObject({ blockType: 'group', blockPreset: 'interval', blockRounds: 6 })
    expect(activeRecovery.parsed[1]?.structure).toEqual(activeRecovery.parsed[0]?.structure)
  })

  it('записывает темповый и длительный бег под единым ref running', () => {
    for (const text of ['Темповый бег 30 мин 5 км', 'Длительный бег 60 мин 10 км']) {
      const result = parseQuickWorkoutEntry(text, SYSTEM_EXERCISE_CATALOG)
      expect(result.unparsed, text).toEqual([])
      expect(result.parsed[0]?.exercise.ref, text).toBe('running')
    }
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

  it('не передаёт RPE, который не примет ограничение базы', () => {
    const result = parseQuickWorkoutEntry('Присед со штангой 3×8 80 кг RPE 5\nЖим лёжа 3×8 60 кг RPE 6.2', catalog)
    expect(result.parsed[0]?.sets).toEqual([
      { position: 0, weightKg: 80, reps: 8 },
      { position: 1, weightKg: 80, reps: 8 },
      { position: 2, weightKg: 80, reps: 8 },
    ])
    expect(result.parsed[1]?.sets).toEqual([
      { position: 0, weightKg: 60, reps: 8 },
      { position: 1, weightKg: 60, reps: 8 },
      { position: 2, weightKg: 60, reps: 8 },
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

  it('разделяет слитую диктовку по каталожному названию и спортивному алиасу', () => {
    const text = 'Румынская тяга 3 подхода по 15 раз по 20 килограмм Жим гантелей в наклонной скамье 3 подхода 15 килограмм 15 раз'
    const formatted = formatWorkoutText(text, SYSTEM_EXERCISE_CATALOG)
    const result = parseQuickWorkoutEntry(text, SYSTEM_EXERCISE_CATALOG)

    expect(formatted).toContain('\nЖим гантелей в наклонной скамье')
    expect(result.unparsed).toEqual([])
    expect(result.parsed.map((item) => item.exercise.ref)).toEqual(['romanian-deadlift', 'fedb-incline-dumbbell-press'])
  })

  it('готовит отдельные фрагменты и кандидатов для LLM-разбора слитой диктовки', () => {
    const text = 'Жим лёжа 100 килограмм 3 подхода по 12 раз Присед со штангой 80 килограмм 4 подхода по 15 повторений'
    const segments = splitWorkoutText(text, catalog)

    expect(segments).toEqual([
      'Жим лёжа 100 килограмм 3 подхода по 12 раз',
      'Присед со штангой 80 килограмм 4 подхода по 15 повторений',
    ])
    expect(workoutCandidates(segments[0]!, catalog).map(({ ref }) => ref)).toContain('bench')
    expect(workoutCandidates(segments[1]!, catalog).map(({ ref }) => ref)).toContain('squat')
  })

  it('не выбирает упражнение молча, если название неоднозначно или не найдено', () => {
    const result = parseQuickWorkoutEntry('Присед 3×8 80 кг\nНесуществующее 3×10', catalog)
    expect(result.parsed).toEqual([])
    expect(result.unparsed[0]).toMatchObject({ line: 'Присед 3×8 80 кг', reason: 'ambiguous', candidates: [{ ref: 'squat' }] })
    expect(result.unparsed[1]).toEqual({ line: 'Несуществующее 3×10', reason: 'not-found', candidates: [] })
  })

  it('выносит базовый присед выше частных вариаций при коротком запросе', () => {
    expect(rankExerciseSearch(SYSTEM_EXERCISE_CATALOG, 'присед').slice(0, 3).map(({ exercise }) => exercise.ref))
      .toContain('barbell-squat')
    expect(rankExerciseSearch(SYSTEM_EXERCISE_CATALOG, 'присед')[0]?.exercise.ref).toBe('barbell-squat')
  })

  it('поднимает частое упражнение клиента среди неоднозначных вариантов, не включая автоподстановку', () => {
    const result = parseQuickWorkoutEntry('Присед 3×8 80 кг', [
      ...catalog,
      { source: 'system', ref: 'front-squat', name: 'Фронтальный присед', muscleGroup: 'legs', inputKind: 'strength' },
    ], { preferredExerciseRefs: ['front-squat', 'squat'] })

    expect(result.parsed).toEqual([])
    expect(result.unparsed[0]).toMatchObject({ reason: 'ambiguous' })
    expect(result.unparsed[0]?.candidates.map((exercise) => exercise.ref)).toEqual(['front-squat', 'squat'])
  })

  it('понимает короткое тренерское сокращение для базового упражнения', () => {
    const result = parseQuickWorkoutEntry('биц 3×12', SYSTEM_EXERCISE_CATALOG)

    expect(result.unparsed).toEqual([])
    expect(result.parsed[0]?.exercise.ref).toBe('biceps-curl')
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
