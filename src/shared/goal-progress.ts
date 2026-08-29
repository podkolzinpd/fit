import type { GoalCriterion, ProgressEntry, StandardGoalCriterionMetric } from './domain'
import { daysBetween, type LocalDate } from './local-date'
import { GOAL_CRITERION_METRICS, isStandardGoalCriterionMetric } from './goal-criterion-rules'

export const STANDARD_GOAL_PROGRESS_POLICY = {
  freshnessDays: { weight: 14, waist: 30, chest: 30, hips: 30 } satisfies Record<StandardGoalCriterionMetric, number>,
  maintainWindowDays: 28,
  maintainMinMeasurements: 2,
  maintainMinSpanDays: 7,
  comparisonEpsilon: 0.001,
} as const

export type GoalProgressStatus =
  | 'target_reached'
  | 'target_not_reached'
  | 'in_range_now'
  | 'range_maintained'
  | 'outside_range'
  | 'tracking'
  | 'needs_data'
  | 'needs_baseline'

export type GoalProgressDirection =
  | 'toward_target'
  | 'away_from_target'
  | 'stable'
  | 'increased'
  | 'decreased'
  | 'unchanged'
  | 'insufficient_data'

export type GoalProgressSufficiency = 'none' | 'position_only' | 'enough_for_dynamics' | 'enough_for_maintenance'

export type GoalProgressObservation = { entryId: string; recordedOn: LocalDate; value: number }

export interface StandardGoalProgress {
  status: GoalProgressStatus
  current: GoalProgressObservation | null
  periodEnd: GoalProgressObservation | null
  latestNow: GoalProgressObservation | null
  hasNewerValueAfterPeriod: boolean
  absoluteTarget: number | null
  baseline: { value: number; recordedOn: LocalDate } | null
  dynamics: {
    first: GoalProgressObservation | null
    last: GoalProgressObservation | null
    count: number
    delta: number | null
    direction: GoalProgressDirection
  }
  sufficiency: GoalProgressSufficiency
  freshness: 'fresh' | 'stale' | 'no_data'
  ageDays: number | null
}

function observations(criterion: GoalCriterion, entries: readonly ProgressEntry[]): GoalProgressObservation[] {
  if (!isStandardGoalCriterionMetric(criterion.metric)) return []
  const key = GOAL_CRITERION_METRICS[criterion.metric].progressKey!
  return entries.flatMap((entry) => {
    const value = entry[key]
    return typeof value === 'number' && Number.isFinite(value)
      ? [{ entryId: entry.id, recordedOn: entry.recordedOn, value }]
      : []
  }).sort((left, right) => left.recordedOn.localeCompare(right.recordedOn) || left.entryId.localeCompare(right.entryId))
}

function distanceToTarget(value: number, criterion: GoalCriterion, absoluteTarget: number | null): number {
  if (criterion.operation === 'maintain_range') {
    const min = criterion.rangeMin ?? 0
    const max = criterion.rangeMax ?? 0
    return value < min ? min - value : value > max ? value - max : 0
  }
  if (absoluteTarget === null) return 0
  const decreasing = criterion.operation === 'decrease_to'
    || (criterion.operation === 'change_by' && (criterion.targetValue ?? 0) < 0)
  return decreasing ? Math.max(0, value - absoluteTarget) : Math.max(0, absoluteTarget - value)
}

function periodDirection(
  criterion: GoalCriterion,
  first: GoalProgressObservation | null,
  last: GoalProgressObservation | null,
  absoluteTarget: number | null,
): GoalProgressDirection {
  if (!first || !last || first.entryId === last.entryId) return 'insufficient_data'
  const delta = last.value - first.value
  if (criterion.operation === 'track_only') {
    if (Math.abs(delta) <= STANDARD_GOAL_PROGRESS_POLICY.comparisonEpsilon) return 'unchanged'
    return delta > 0 ? 'increased' : 'decreased'
  }
  const before = distanceToTarget(first.value, criterion, absoluteTarget)
  const after = distanceToTarget(last.value, criterion, absoluteTarget)
  if (Math.abs(after - before) <= STANDARD_GOAL_PROGRESS_POLICY.comparisonEpsilon) return 'stable'
  return after < before ? 'toward_target' : 'away_from_target'
}

function status(
  criterion: GoalCriterion,
  current: GoalProgressObservation | null,
  absoluteTarget: number | null,
  all: readonly GoalProgressObservation[],
  today: LocalDate,
): GoalProgressStatus {
  if (!current) return 'needs_data'
  if (criterion.operation === 'change_by' && absoluteTarget === null) return 'needs_baseline'
  if (criterion.operation === 'track_only') return 'tracking'
  if (criterion.operation === 'maintain_range') {
    const inRange = current.value >= (criterion.rangeMin ?? 0) && current.value <= (criterion.rangeMax ?? 0)
    if (!inRange) return 'outside_range'
    const windowStartAge = STANDARD_GOAL_PROGRESS_POLICY.maintainWindowDays
    const window = all.filter((item) => daysBetween(item.recordedOn, today) >= 0
      && daysBetween(item.recordedOn, today) <= windowStartAge)
    const enough = window.length >= STANDARD_GOAL_PROGRESS_POLICY.maintainMinMeasurements
      && daysBetween(window[0]!.recordedOn, window.at(-1)!.recordedOn) >= STANDARD_GOAL_PROGRESS_POLICY.maintainMinSpanDays
    const allInRange = window.every((item) => item.value >= (criterion.rangeMin ?? 0) && item.value <= (criterion.rangeMax ?? 0))
    return enough && allInRange ? 'range_maintained' : 'in_range_now'
  }
  if (criterion.operation === 'decrease_to'
    || (criterion.operation === 'change_by' && (criterion.targetValue ?? 0) < 0)) {
    return current.value <= (absoluteTarget ?? 0) ? 'target_reached' : 'target_not_reached'
  }
  return current.value >= (absoluteTarget ?? Number.POSITIVE_INFINITY) ? 'target_reached' : 'target_not_reached'
}

export function calculateStandardGoalProgress(
  criterion: GoalCriterion,
  entries: readonly ProgressEntry[],
  periodStart: LocalDate,
  periodEnd: LocalDate,
  today: LocalDate,
): StandardGoalProgress {
  if (!isStandardGoalCriterionMetric(criterion.metric)) {
    throw new Error('standard_goal_metric_required')
  }
  const all = observations(criterion, entries)
  const throughToday = all.filter((item) => item.recordedOn <= today)
  const latestNow = throughToday.at(-1) ?? null
  const throughPeriod = all.filter((item) => item.recordedOn <= periodEnd)
  const periodEndValue = throughPeriod.at(-1) ?? null
  const inPeriod = all.filter((item) => item.recordedOn >= periodStart && item.recordedOn <= periodEnd)
  const first = inPeriod[0] ?? null
  const last = inPeriod.at(-1) ?? null
  const baseline = criterion.baselineValue !== null && criterion.baselineRecordedOn !== null
    ? { value: criterion.baselineValue, recordedOn: criterion.baselineRecordedOn }
    : null
  const absoluteTarget = criterion.operation === 'change_by'
    ? baseline === null ? null : baseline.value + (criterion.targetValue ?? 0)
    : criterion.operation === 'maintain_range' || criterion.operation === 'track_only'
      ? null : criterion.targetValue
  const ageDays = latestNow ? daysBetween(latestNow.recordedOn, today) : null
  const freshness = ageDays === null ? 'no_data'
    : ageDays <= STANDARD_GOAL_PROGRESS_POLICY.freshnessDays[criterion.metric] ? 'fresh' : 'stale'
  const direction = periodDirection(criterion, first, last, absoluteTarget)
  const maintenanceWindow = throughToday.filter((item) => daysBetween(item.recordedOn, today) <= STANDARD_GOAL_PROGRESS_POLICY.maintainWindowDays)
  const maintenanceEnough = criterion.operation === 'maintain_range'
    && maintenanceWindow.length >= STANDARD_GOAL_PROGRESS_POLICY.maintainMinMeasurements
    && daysBetween(maintenanceWindow[0]!.recordedOn, maintenanceWindow.at(-1)!.recordedOn) >= STANDARD_GOAL_PROGRESS_POLICY.maintainMinSpanDays
  const sufficiency: GoalProgressSufficiency = latestNow === null ? 'none'
    : maintenanceEnough ? 'enough_for_maintenance'
      : inPeriod.length >= 2 ? 'enough_for_dynamics' : 'position_only'

  return {
    status: status(criterion, latestNow, absoluteTarget, throughToday, today),
    current: latestNow,
    periodEnd: periodEndValue,
    latestNow,
    hasNewerValueAfterPeriod: Boolean(latestNow && latestNow.recordedOn > periodEnd),
    absoluteTarget,
    baseline,
    dynamics: {
      first, last, count: inPeriod.length,
      delta: first && last && first.entryId !== last.entryId ? last.value - first.value : null,
      direction,
    },
    sufficiency,
    freshness,
    ageDays,
  }
}
