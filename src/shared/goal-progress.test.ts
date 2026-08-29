import { describe, expect, it } from 'vitest'
import type { GoalCriterion, GoalCriterionMetric, ProgressEntry } from './domain'
import { calculateStandardGoalProgress, STANDARD_GOAL_PROGRESS_POLICY } from './goal-progress'
import { localDate } from './local-date'

function criterion(overrides: Partial<GoalCriterion> = {}): GoalCriterion {
  return {
    id: 'criterion-1', goalId: 'goal-1', metric: 'weight', operation: 'decrease_to',
    targetValue: 75, rangeMin: null, rangeMax: null, unit: 'кг',
    baselineValue: null, baselineRecordedOn: null,
    confirmationStatus: 'confirmed', position: 0, version: 1, ...overrides,
  }
}

function entry(id: string, date: string, metric: GoalCriterionMetric, value: number): ProgressEntry {
  const key = { weight: 'weightKg', waist: 'waistCm', chest: 'chestCm', hips: 'hipCm' }[metric]
  return {
    id, clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate(date),
    [key]: value, customMetrics: [], version: 1,
  }
}

const periodStart = localDate('2026-08-01')
const periodEnd = localDate('2026-08-31')
const today = localDate('2026-09-05')

describe('standard goal progress calculation', () => {
  it('evaluates decrease_to and period movement without percentages', () => {
    const result = calculateStandardGoalProgress(criterion(), [
      entry('a', '2026-08-01', 'weight', 80), entry('b', '2026-08-31', 'weight', 76),
    ], periodStart, periodEnd, today)

    expect(result.status).toBe('target_not_reached')
    expect(result.current?.value).toBe(76)
    expect(result.dynamics).toMatchObject({ count: 2, delta: -4, direction: 'toward_target' })
    expect(result.sufficiency).toBe('enough_for_dynamics')
  })

  it('supports increase_to for every standard circumference metric', () => {
    for (const metric of ['waist', 'chest', 'hips'] as const) {
      const result = calculateStandardGoalProgress(criterion({
        metric, operation: 'increase_to', targetValue: 90, unit: 'см',
      }), [entry('a', '2026-08-10', metric, 89), entry('b', '2026-08-30', metric, 91)], periodStart, periodEnd, today)
      expect(result.status).toBe('target_reached')
      expect(result.dynamics.direction).toBe('toward_target')
    }
  })

  it('does not declare a range maintained from one measurement', () => {
    const value = criterion({ operation: 'maintain_range', targetValue: null, rangeMin: 58.5, rangeMax: 59.5 })
    const result = calculateStandardGoalProgress(value, [entry('a', '2026-09-01', 'weight', 59)], periodStart, periodEnd, today)

    expect(result.status).toBe('in_range_now')
    expect(result.sufficiency).toBe('position_only')
  })

  it('requires the named count and span policies before declaring a range maintained', () => {
    expect(STANDARD_GOAL_PROGRESS_POLICY.maintainMinMeasurements).toBe(2)
    expect(STANDARD_GOAL_PROGRESS_POLICY.maintainMinSpanDays).toBe(7)
    const value = criterion({ operation: 'maintain_range', targetValue: null, rangeMin: 58.5, rangeMax: 59.5 })
    const result = calculateStandardGoalProgress(value, [
      entry('a', '2026-08-26', 'weight', 58.8), entry('b', '2026-09-05', 'weight', 59.2),
    ], periodStart, periodEnd, today)

    expect(result.status).toBe('range_maintained')
    expect(result.sufficiency).toBe('enough_for_maintenance')
  })

  it('uses a persisted baseline for change_by', () => {
    const value = criterion({
      operation: 'change_by', targetValue: -3, baselineValue: 80,
      baselineRecordedOn: localDate('2026-07-31'),
    })
    const result = calculateStandardGoalProgress(value, [entry('a', '2026-08-31', 'weight', 77)], periodStart, periodEnd, today)

    expect(result.absoluteTarget).toBe(77)
    expect(result.status).toBe('target_reached')
    expect(result.baseline).toEqual({ value: 80, recordedOn: localDate('2026-07-31') })
  })

  it('does not invent a relative result without a baseline', () => {
    const result = calculateStandardGoalProgress(criterion({ operation: 'change_by', targetValue: -3 }), [
      entry('a', '2026-08-31', 'weight', 77),
    ], periodStart, periodEnd, today)
    expect(result.status).toBe('needs_baseline')
    expect(result.absoluteTarget).toBeNull()
  })

  it('keeps track_only direction descriptive rather than favorable', () => {
    const result = calculateStandardGoalProgress(criterion({ operation: 'track_only', targetValue: null }), [
      entry('a', '2026-08-01', 'weight', 80), entry('b', '2026-08-31', 'weight', 78),
    ], periodStart, periodEnd, today)
    expect(result.status).toBe('tracking')
    expect(result.dynamics.direction).toBe('decreased')
  })

  it('distinguishes the period-end value from a newer current value', () => {
    const result = calculateStandardGoalProgress(criterion(), [
      entry('a', '2026-08-31', 'weight', 78), entry('b', '2026-09-04', 'weight', 74.5),
    ], periodStart, periodEnd, today)
    expect(result.periodEnd?.value).toBe(78)
    expect(result.latestNow?.value).toBe(74.5)
    expect(result.hasNewerValueAfterPeriod).toBe(true)
    expect(result.status).toBe('target_reached')
  })

  it('uses the last known value as period-end but only in-period points for dynamics', () => {
    const result = calculateStandardGoalProgress(criterion(), [entry('a', '2026-07-20', 'weight', 80)], periodStart, periodEnd, today)
    expect(result.periodEnd?.value).toBe(80)
    expect(result.dynamics).toMatchObject({ count: 0, delta: null, direction: 'insufficient_data' })
  })

  it('marks old measurements stale with metric-specific named policies', () => {
    expect(STANDARD_GOAL_PROGRESS_POLICY.freshnessDays.weight).toBe(14)
    expect(STANDARD_GOAL_PROGRESS_POLICY.freshnessDays.waist).toBe(30)
    const weight = calculateStandardGoalProgress(criterion(), [entry('a', '2026-08-01', 'weight', 76)], periodStart, periodEnd, today)
    const waist = calculateStandardGoalProgress(criterion({ metric: 'waist', unit: 'см' }), [entry('b', '2026-08-10', 'waist', 76)], periodStart, periodEnd, today)
    expect(weight.freshness).toBe('stale')
    expect(waist.freshness).toBe('fresh')
  })

  it('ignores future measurements and handles no data honestly', () => {
    const result = calculateStandardGoalProgress(criterion(), [entry('future', '2026-09-06', 'weight', 70)], periodStart, periodEnd, today)
    expect(result.status).toBe('needs_data')
    expect(result.current).toBeNull()
    expect(result.freshness).toBe('no_data')
  })
})
