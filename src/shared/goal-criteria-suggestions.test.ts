import { describe, expect, it } from 'vitest'
import type { CustomMetric, ExerciseSnapshot } from './domain'
import { validateGoalCriteriaSuggestion } from './goal-criteria-suggestions'

const exercises: ExerciseSnapshot[] = [{ source: 'system', ref: 'running', name: 'Бег', muscleGroup: 'cardio', inputKind: 'distance' }]
const metrics: CustomMetric[] = [{ id: 'sleep', clientId: 'client', name: 'Сон', unit: 'ч', archivedAt: null, version: 1 }]

describe('goal criteria LLM suggestion boundary', () => {
  it('rejects retired system suggestions but preserves a custom exercise with the same ref', () => {
    const retired: ExerciseSnapshot = { source: 'system', ref: 'fedb-atlas-stones', name: 'Камни Атласа', muscleGroup: 'other', inputKind: 'strength' }
    const suggestion = { criteria: [{ metric: 'exercise_reps', operation: 'increase_to', targetValue: 10, unit: 'повт.', exerciseRef: retired.ref }], needsInput: [], unsupportedReason: null }
    expect(() => validateGoalCriteriaSuggestion(suggestion, [retired], [])).toThrow('invalid_goal_suggestion')
    expect(validateGoalCriteriaSuggestion(suggestion, [{ ...retired, source: 'custom', customExerciseId: 'custom' }], []).criteria[0]?.exerciseSource).toBe('custom')
  })

  it('turns strict output into ordinary unconfirmed UI drafts without calculating progress', () => {
    const result = validateGoalCriteriaSuggestion({ criteria: [{
      metric: 'cardio_distance_time', operation: 'increase_to', targetValue: 5, rangeMin: null, rangeMax: null,
      unit: 'км', secondaryTargetValue: 30, secondaryUnit: 'мин', exerciseRef: 'running', customMetricId: null,
      regularityPeriod: null, regularityMode: null,
    }], needsInput: [], unsupportedReason: null }, exercises, metrics)
    expect(result.criteria[0]).toMatchObject({ exerciseRef: 'running', exerciseName: 'Бег', targetValue: 5, secondaryTargetValue: 30 })
    expect(result.criteria[0]).not.toHaveProperty('status')
  })

  it('rejects invented exercises and archived custom metrics', () => {
    expect(() => validateGoalCriteriaSuggestion({ criteria: [{ metric: 'cardio_distance', operation: 'increase_to', targetValue: 5, rangeMin: null, rangeMax: null, unit: 'км', secondaryTargetValue: null, secondaryUnit: null, exerciseRef: 'invented' }], needsInput: [], unsupportedReason: null }, exercises, metrics)).toThrow('invalid_goal_suggestion')
    expect(() => validateGoalCriteriaSuggestion({ criteria: [{ metric: 'custom', operation: 'track_only', targetValue: null, rangeMin: null, rangeMax: null, unit: 'ч', secondaryTargetValue: null, secondaryUnit: null, customMetricId: 'sleep' }], needsInput: [], unsupportedReason: null }, exercises, [{ ...metrics[0]!, archivedAt: '2026-08-01' }])).toThrow('invalid_goal_suggestion')
  })

  it('preserves ambiguity and unsupported medical wording instead of guessing', () => {
    expect(validateGoalCriteriaSuggestion({ criteria: [], needsInput: [{ message: 'Выберите вариант бега', exerciseRefs: ['running', 'invented'] }], unsupportedReason: null }, exercises, metrics).needsInput)
      .toEqual([{ message: 'Выберите вариант бега', exerciseRefs: ['running'] }])
    expect(validateGoalCriteriaSuggestion({ criteria: [], needsInput: [], unsupportedReason: 'Медицинскую цель нельзя оценить по тренировочным данным' }, exercises, metrics).unsupportedReason).toMatch(/Медицинскую/)
  })

  it('rejects malformed values, missing units and unsupported operations', () => {
    for (const value of [
      { criteria: [{ metric: 'weight', operation: 'increase_to', targetValue: Number.NaN, rangeMin: null, rangeMax: null, unit: 'кг', secondaryTargetValue: null, secondaryUnit: null }], needsInput: [], unsupportedReason: null },
      { criteria: [{ metric: 'weight', operation: 'increase_to', targetValue: 80, rangeMin: null, rangeMax: null, unit: '', secondaryTargetValue: null, secondaryUnit: null }], needsInput: [], unsupportedReason: null },
      { criteria: [{ metric: 'exercise_reps', operation: 'change_by', targetValue: 5, rangeMin: null, rangeMax: null, unit: 'повт.', secondaryTargetValue: null, secondaryUnit: null, exerciseRef: 'running' }], needsInput: [], unsupportedReason: null },
    ]) expect(() => validateGoalCriteriaSuggestion(value, exercises, metrics)).toThrow('invalid_goal_suggestion')
  })
})
