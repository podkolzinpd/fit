import { describe, expect, it } from 'vitest'
import type { GoalCriterion, ProgressEntry, SaveGoalCriterionInput } from './domain'
import { goalCriterionFoundationState, goalCriterionTargetLabel, validateGoalCriterionInput } from './goal-criterion-rules'
import { localDate } from './local-date'

const criterion: GoalCriterion = {
  id: 'criterion-1', goalId: 'goal-1', metric: 'weight', operation: 'maintain_range',
  targetValue: null, rangeMin: 58.5, rangeMax: 59.5, unit: 'кг',
  confirmationStatus: 'confirmed', position: 0, version: 1,
}

const measurement: ProgressEntry = {
  id: 'measurement-1', clientId: 'client-1', createdBy: 'client-1',
  recordedOn: localDate('2026-08-29'), weightKg: 59, customMetrics: [], version: 1,
}

describe('goal criterion foundation', () => {
  it('distinguishes unconfigured, review, missing-data and configured states', () => {
    expect(goalCriterionFoundationState(undefined, [])).toBe('unconfigured')
    expect(goalCriterionFoundationState({ ...criterion, confirmationStatus: 'needs_review' }, [measurement])).toBe('needs_review')
    expect(goalCriterionFoundationState(criterion, [])).toBe('needs_data')
    expect(goalCriterionFoundationState(criterion, [measurement])).toBe('configured')
  })

  it('does not treat a different measurement as data for the configured metric', () => {
    expect(goalCriterionFoundationState({ ...criterion, metric: 'waist', unit: 'см' }, [measurement])).toBe('needs_data')
  })

  it('formats a range and a target without evaluating them', () => {
    expect(goalCriterionTargetLabel(criterion)).toBe('58,5–59,5 кг')
    expect(goalCriterionTargetLabel({ ...criterion, operation: 'decrease_to', targetValue: 59, rangeMin: null, rangeMax: null })).toBe('снизить до 59 кг')
  })

  it('validates operation fields and the metric unit deterministically', () => {
    const valid: SaveGoalCriterionInput = {
      metric: 'weight', operation: 'maintain_range', rangeMin: 58.5, rangeMax: 59.5,
      unit: 'кг', confirmationStatus: 'confirmed',
    }
    expect(validateGoalCriterionInput(valid)).toBeUndefined()
    expect(validateGoalCriterionInput({ ...valid, rangeMax: 58 })).toBe('Укажите корректный диапазон')
    expect(validateGoalCriterionInput({ ...valid, unit: 'см' })).toBe('Для показателя «Вес» используется единица «кг»')
    expect(validateGoalCriterionInput({ ...valid, operation: 'decrease_to', targetValue: null })).toBe('Укажите целевое значение')
    expect(validateGoalCriterionInput({ ...valid, operation: 'track_only' })).toBe('Для отслеживания без ориентира числовые значения не нужны')
    expect(validateGoalCriterionInput({ ...valid, operation: 'change_by', targetValue: -3, rangeMin: null, rangeMax: null })).toBeUndefined()
    expect(goalCriterionTargetLabel({ ...criterion, operation: 'change_by', targetValue: -3, rangeMin: null, rangeMax: null })).toBe('изменить на -3 кг')
  })
})
