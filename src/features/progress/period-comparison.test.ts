import { describe, expect, it } from 'vitest'
import type { ClientGoal, ProgressEntry, Workout, WorkoutExercise } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { buildPeriodComparison } from './period-comparison'

const currentPeriod = { start: localDate('2026-08-01'), end: localDate('2026-08-31') }
const previousPeriod = { start: localDate('2026-07-01'), end: localDate('2026-07-31') }

function exercise(id: string, inputKind: WorkoutExercise['inputKind'], values: Array<{ weight?: number; reps?: number; distance?: number; duration?: number }>): WorkoutExercise {
  return {
    id, source: 'system', ref: id, name: id === 'press' ? 'Жим лёжа' : 'Бег', muscleGroup: inputKind === 'strength' ? 'chest' : 'cardio', inputKind,
    position: 0, blockId: `${id}-block`, blockType: 'single', blockPreset: 'set', blockRounds: 1,
    restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 60,
    sets: values.map((value, index) => ({
      id: `${id}-${index}`, position: index, weightKg: value.weight, reps: value.reps,
      distanceKm: value.distance, durationMin: value.duration,
      fact: { weightKg: value.weight, reps: value.reps, distanceKm: value.distance, durationMin: value.duration },
      confirmedAt: '2026-08-01T10:00:00Z', version: 1,
    })),
  }
}

function workout(id: string, date: string, weight: number, distance: number, extraStrengthSet = false): Workout {
  const strength = [{ weight, reps: 10 }, ...(extraStrengthSet ? [{ weight, reps: 8 }] : [])]
  return {
    id, clientId: 'client-1', clientName: 'Антон', workoutDate: localDate(date), startTime: null, endTime: null,
    startedAt: null, completedAt: `${date}T10:00:00Z`, status: 'done', notes: null, stageId: null,
    stageTitle: null, version: 1,
    exercises: [exercise('press', 'strength', strength), exercise('run', 'distance', [{ distance, duration: 30 }])],
  }
}

const measurements: ProgressEntry[] = [
  { id: 'july', clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate('2026-07-20'), weightKg: 80, waistCm: 90, customMetrics: [], version: 1 },
  { id: 'august', clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate('2026-08-20'), weightKg: 81, waistCm: 88, customMetrics: [], version: 1 },
]

const goal: ClientGoal = {
  id: 'goal-1', clientId: 'client-1', title: 'Набрать массу и усилить жим', targetDate: null,
  status: 'active', version: 1, stages: [], criteria: [{
    id: 'weight-goal', goalId: 'goal-1', metric: 'weight', operation: 'increase_to', targetValue: 85,
    rangeMin: null, rangeMax: null, unit: 'кг', baselineValue: null, baselineRecordedOn: null,
    confirmationStatus: 'confirmed', position: 0, version: 1,
  }],
}

function completeComparison(llmCandidates: string[] = []) {
  return buildPeriodComparison({
    currentPeriod, previousPeriod,
    previousWorkouts: [workout('previous-1', '2026-07-03', 50, 5)],
    currentWorkouts: [
      workout('current-1', '2026-08-03', 60, 7, true),
      workout('current-2', '2026-08-17', 60, 7, true),
    ],
    measurements, goal, llmCandidates,
  })
}

describe('buildPeriodComparison', () => {
  it('calculates goal, strength, cardio, measurement, regularity and load facts from equal periods', () => {
    const result = completeComparison()

    expect(result.comparable).toBe(true)
    expect(new Set(result.facts.map((fact) => fact.kind))).toEqual(new Set([
      'goal', 'strength', 'measurement', 'regularity', 'load', 'cardio',
    ]))
    expect(result.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: 'Цель · Вес', previousLabel: '80 кг', currentLabel: '81 кг', tone: 'positive' }),
      expect.objectContaining({ subject: 'Жим лёжа · рабочий вес', previousLabel: '50 кг', currentLabel: '60 кг', tone: 'positive' }),
      expect.objectContaining({ subject: 'Талия', previousLabel: '90 см', currentLabel: '88 см' }),
      expect.objectContaining({ subject: 'Кардио · дистанция', previousLabel: '5 км', currentLabel: '14 км' }),
      expect.objectContaining({ subject: 'Выполненные подходы', previousLabel: '2 подх.', currentLabel: '6 подх.' }),
    ]))
    expect(result.conclusions).toHaveLength(2)
    expect(result.conclusions[1]).toMatchObject({ kind: 'limitation', source: 'deterministic' })
  })

  it('accepts only short LLM wording grounded in one calculated fact', () => {
    const accepted = completeComparison(['Рабочий вес в жиме лёжа изменился с 50 до 60 кг.'])
    expect(accepted.conclusions[0]).toMatchObject({
      kind: 'change', source: 'llm', text: 'Рабочий вес в жиме лёжа изменился с 50 до 60 кг.',
    })
    expect(accepted.conclusions[0]?.factIds[0]).toContain('comparison:strength:')

    const rejected = completeComparison(['Стоит увеличить нагрузку в жиме лёжа до 75 кг.'])
    expect(rejected.conclusions[0]?.source).toBe('deterministic')
    expect(rejected.conclusions[0]?.text).not.toContain('75')
  })

  it('compares a confirmed exercise criterion and removes its duplicate generic strength row', () => {
    const result = buildPeriodComparison({
      currentPeriod, previousPeriod,
      previousWorkouts: [workout('previous', '2026-07-03', 50, 5)],
      currentWorkouts: [workout('current', '2026-08-03', 60, 7)],
      measurements,
      goal: { ...goal, criteria: [...goal.criteria, {
        id: 'press-goal', goalId: 'goal-1', metric: 'exercise_working_weight', operation: 'increase_to', targetValue: 70,
        rangeMin: null, rangeMax: null, unit: 'кг', baselineValue: null, baselineRecordedOn: null,
        exerciseSource: 'system', exerciseRef: 'press', exerciseName: 'Жим лёжа',
        confirmationStatus: 'confirmed', position: 1, version: 1,
      }] },
    })

    expect(result.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'goal', subject: 'Цель · Рабочий вес · Жим лёжа' }),
    ]))
    expect(result.facts.filter((fact) => fact.subject.includes('Жим лёжа'))).toHaveLength(1)
  })

  it('keeps the first period as a neutral baseline without artificial percentages', () => {
    const result = buildPeriodComparison({
      currentPeriod, previousPeriod,
      currentWorkouts: [workout('current', '2026-08-03', 60, 7)],
      previousWorkouts: [], measurements: [], goal: null,
    })

    expect(result.facts).toEqual([])
    expect(result.conclusions).toEqual([])
    expect(result.emptyMessage).toContain('отправная точка')
  })

  it('refuses to compare periods of different length', () => {
    const result = buildPeriodComparison({
      currentPeriod, previousPeriod: { start: localDate('2026-07-10'), end: localDate('2026-07-31') },
      currentWorkouts: [], previousWorkouts: [],
    })

    expect(result.comparable).toBe(false)
    expect(result.facts).toEqual([])
    expect(result.conclusions[0]).toMatchObject({ kind: 'limitation', factIds: [] })
  })

  it('can remove a fact already used as the main conclusion', () => {
    const result = buildPeriodComparison({
      currentPeriod, previousPeriod,
      currentWorkouts: [workout('current', '2026-08-03', 60, 7)],
      previousWorkouts: [workout('previous', '2026-07-03', 50, 5)],
      excludedSubject: 'Жим лёжа',
      excludedKinds: ['regularity'],
    })

    expect(result.facts.some((fact) => fact.subject.includes('Жим лёжа'))).toBe(false)
    expect(result.facts.some((fact) => fact.kind === 'regularity')).toBe(false)
    expect(result.facts.some((fact) => fact.kind === 'cardio')).toBe(true)
  })
})
