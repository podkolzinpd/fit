import { describe, expect, it } from 'vitest'
import type { PublishedTrainingSummary, Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { bodyZoneForExerciseName, loadBodyMap, muscleGroupForExerciseName, progressBodyMap } from './body-progress-map'

const summary: PublishedTrainingSummary = {
  id: 'published-1', sourceSummaryId: 'summary-1', clientId: 'client-1',
  periodStart: localDate('2026-07-25'), periodEnd: localDate('2026-08-25'),
  summary: { headline: '', achievements: [], consistency: '', encouragement: '' },
  metrics: {
    completedWorkouts: 3, workoutsPerWeek: 1, activeWeeks: 3, longestGapDays: 5,
    progressFacts: [{
      exerciseName: 'Жим гантелей лёжа (Гантели)', kind: 'strength', sessionCount: 3,
      changes: [{ metric: 'volume', from: 1000, to: 1400, changePercent: 40, favorable: true }],
    }, {
      exerciseName: 'Тяга верхнего блока (Блок)', kind: 'strength', sessionCount: 3,
      changes: [{ metric: 'max_weight', from: 50, to: 68, changePercent: 36, favorable: true }],
    }],
  },
  generatedAt: '2026-08-25T08:00:00Z', publishedAt: '2026-08-25T08:00:00Z',
}

describe('body progress map', () => {
  it('maps catalog exercise variants to body groups', () => {
    expect(muscleGroupForExerciseName('Жим гантелей лёжа (Гантели)')).toBe('chest')
    expect(muscleGroupForExerciseName('Тяга верхнего блока (Блок)')).toBe('back')
  })

  it.each([
    ['Ягодичный мост со штангой', 'glutes'],
    ['Скручивания на пресс', 'core'],
    ['Молот с гантелями', 'arms'],
    ['Махи на дельты', 'shoulders'],
    ['Гиперэкстензия с блином', 'back'],
    ['Выпады назад', 'legs'],
    ['Бабочка в тренажёре', 'chest'],
    ['Ходьба на дорожке', 'cardio'],
    ['Неизвестное движение', 'other'],
  ] as const)('uses a readable fallback for %s', (name, group) => {
    expect(muscleGroupForExerciseName(name)).toBe(group)
  })

  it.each([
    ['Сгибание на бицепс (Гантели)', 'biceps'],
    ['Французский жим', 'triceps'],
    ['Сгибание кистей на предплечья', 'forearms'],
    ['Тяга верхнего блока (Блок)', 'upper_back'],
    ['Гиперэкстензия с блином', 'lower_back'],
    ['Ягодичный мост', 'glutes'],
    ['Разгибание ног (Тренажёр)', 'quadriceps'],
    ['Сгибание ног лёжа (Тренажёр)', 'hamstrings'],
    ['Подъём на носки стоя (Тренажёр)', 'calves'],
  ] as const)('maps %s to the precise body zone', (name, zone) => {
    expect(bodyZoneForExerciseName(name)).toBe(zone)
  })

  it('aggregates only favorable confirmed progress facts by muscle group', () => {
    const result = progressBodyMap(summary)
    expect(result.regions.map((region) => [region.group, region.percent])).toEqual([
      ['chest', 40], ['upper_back', 36],
    ])
    expect(result.regions[0]!.metricLabel).toBe('Лучший результат зоны')
    expect(result.regions[0]!.primaryDetail).toBe(
      'Жим гантелей лёжа (Гантели) · Объём за тренировку: 1 000 → 1 400 кг',
    )
  })

  it('uses the strongest confirmed improvement in a zone and ignores unsupported body metrics', () => {
    const result = progressBodyMap({
      ...summary,
      metrics: {
        ...summary.metrics,
        progressFacts: [{
          exerciseName: 'Жим гантелей лёжа', kind: 'strength', sessionCount: 3,
          changes: [{ metric: 'volume', from: 1000, to: 1400, changePercent: 40, favorable: true }],
        }, {
          exerciseName: 'Отжимания', kind: 'strength', sessionCount: 3,
          changes: [{ metric: 'total_reps', from: 20, to: 30, changePercent: 50, favorable: true }],
        }, {
          exerciseName: 'Бег', kind: 'distance', sessionCount: 3,
          changes: [{ metric: 'pace', from: 360, to: 330, changePercent: -8.3, favorable: true }],
        }, {
          exerciseName: 'Плавание', kind: 'distance', sessionCount: 3,
          changes: [{ metric: 'distance', from: 1, to: 2, changePercent: 100, favorable: false }],
        }],
      },
    })

    expect(result.regions.find((region) => region.group === 'chest')?.percent).toBe(50)
    expect(result.regions).toHaveLength(1)
  })

  it('uses confirmed sets of completed workouts for load shares', () => {
    const workout = {
      id: 'workout-1', clientId: 'client-1', workoutDate: localDate('2026-08-24'), status: 'done',
      exercises: [{ name: 'Жим лёжа', muscleGroup: 'chest', sets: [
        { confirmedAt: '2026-08-24T10:00:00Z' }, { confirmedAt: '2026-08-24T10:01:00Z' },
      ] }, { name: 'Тяга блока', muscleGroup: 'back', sets: [
        { confirmedAt: '2026-08-24T10:02:00Z' },
      ] }],
    } as Workout
    const result = loadBodyMap([workout], '2026-08-01', '2026-08-25')
    expect(result.regions.map((region) => [region.group, region.percent])).toEqual([
      ['chest', 67], ['upper_back', 33],
    ])
    expect(result.regions[0]?.metricLabel).toBe('Доля всех выполненных подходов')
    expect(result.regions[0]?.primaryDetail).toBe('2 из 3 подходов')
  })

  it('ignores drafts and workouts outside the period and uses correct set plurals', () => {
    const done = {
      id: 'workout-2', clientId: 'client-1', workoutDate: localDate('2026-08-24'), status: 'done',
      exercises: [{ name: 'Присед', muscleGroup: 'legs', sets: [
        { confirmedAt: '2026-08-24T10:00:00Z' }, { confirmedAt: '2026-08-24T10:01:00Z' },
        { confirmedAt: '2026-08-24T10:02:00Z' }, { confirmedAt: '2026-08-24T10:03:00Z' },
        { confirmedAt: '2026-08-24T10:04:00Z' }, { confirmedAt: null },
      ] }],
    } as Workout
    const planned = { ...done, id: 'planned', status: 'planned' } as Workout
    const outside = { ...done, id: 'outside', workoutDate: localDate('2026-07-31') } as Workout

    const result = loadBodyMap([planned, outside, done], '2026-08-01', '2026-08-25')
    expect(result.regions).toHaveLength(1)
    expect(result.regions[0]?.group).toBe('quadriceps')
    expect(result.regions[0]?.details).toEqual(['Присед: 5 подходов'])
  })

  it('keeps load-only zones out of progress and exposes them in load', () => {
    const workout = {
      id: 'workout-arms', clientId: 'client-1', workoutDate: localDate('2026-08-24'), status: 'done',
      exercises: [{ name: 'Молот с гантелями', muscleGroup: 'arms', sets: [
        { confirmedAt: '2026-08-24T10:00:00Z' }, { confirmedAt: '2026-08-24T10:01:00Z' },
      ] }],
    } as Workout

    expect(progressBodyMap({ ...summary, metrics: { ...summary.metrics, progressFacts: [] } }).regions).toEqual([])
    expect(loadBodyMap([workout], '2026-08-01', '2026-08-25').regions[0]?.group).toBe('biceps')
  })
})
