import type { GoalCriterion, ProgressEntry, Workout } from './domain'
import { addDays, daysBetween, endOfMonth, endOfWeek, startOfMonth, startOfWeek, type LocalDate } from './local-date'
import type {
  GoalProgressDirection,
  GoalProgressObservation,
  GoalProgressStatus,
  GoalProgressSufficiency,
} from './goal-progress'

export const TRAINING_GOAL_PROGRESS_POLICY = {
  freshnessDays: 30,
  comparisonEpsilon: 0.001,
} as const

export interface GoalCriterionProgress {
  status: GoalProgressStatus
  current: GoalProgressObservation | null
  periodEnd: GoalProgressObservation | null
  latestNow: GoalProgressObservation | null
  hasNewerValueAfterPeriod: boolean
  absoluteTarget: number | null
  secondaryCurrent: number | null
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
  sourceState: 'available' | 'missing' | 'deleted'
  regularity?: { completedPeriods: number; totalPeriods: number; mode: 'average' | 'each_period' }
}

type ObservationWithSecondary = GoalProgressObservation & { secondaryValue?: number }

function confirmedWorkouts(workouts: readonly Workout[], criterion: GoalCriterion, today: LocalDate): Workout[] {
  return workouts.filter((workout) => workout.status === 'done' && workout.workoutDate <= today)
    .filter((workout) => criterion.metric === 'workout_regularity'
      || workout.exercises.some((exercise) => exercise.ref === criterion.exerciseRef))
}

function exerciseObservations(criterion: GoalCriterion, workouts: readonly Workout[], today: LocalDate): ObservationWithSecondary[] {
  const result: ObservationWithSecondary[] = []
  for (const workout of confirmedWorkouts(workouts, criterion, today)) {
    const exercises = workout.exercises.filter((exercise) => exercise.ref === criterion.exerciseRef)
    const sets = exercises.flatMap((exercise) => exercise.sets)
      .filter((set) => Boolean(set.confirmedAt))
      .map((set) => set.fact)
    if (sets.length === 0) continue

    let value: number | null = null
    let secondaryValue: number | undefined
    if (criterion.metric === 'exercise_working_weight') {
      value = Math.max(...sets.flatMap((set) => typeof set.weightKg === 'number' ? [set.weightKg] : []), Number.NEGATIVE_INFINITY)
    } else if (criterion.metric === 'exercise_reps') {
      value = Math.max(...sets.flatMap((set) => typeof set.reps === 'number' ? [set.reps] : []), Number.NEGATIVE_INFINITY)
    } else if (criterion.metric === 'exercise_volume') {
      const volumeSets = sets.filter((set) => typeof set.weightKg === 'number' && typeof set.reps === 'number')
      value = volumeSets.length ? volumeSets.reduce((sum, set) => sum + set.weightKg! * set.reps!, 0) : null
    } else if (criterion.metric === 'exercise_best_result') {
      const candidates = sets.flatMap((set) => {
        if (criterion.unit === 'кг') return typeof set.weightKg === 'number' ? [set.weightKg] : []
        if (criterion.unit === 'повт.') return typeof set.reps === 'number' ? [set.reps] : []
        if (criterion.unit === 'км') return typeof set.distanceKm === 'number' ? [set.distanceKm] : []
        if (criterion.unit === 'мин') {
          const duration = typeof set.durationSec === 'number' ? set.durationSec / 60 : set.durationMin
          return typeof duration === 'number' ? [duration] : []
        }
        return typeof set.weightKg === 'number' && typeof set.reps === 'number'
          ? [set.weightKg * set.reps] : []
      }).filter((item) => Number.isFinite(item))
      value = candidates.length ? Math.max(...candidates) : null
    } else {
      const distance = sets.reduce((sum, set) => sum + (set.distanceKm ?? 0), 0)
      const duration = sets.reduce((sum, set) => sum + (set.durationSec ?? (set.durationMin ?? 0) * 60), 0) / 60
      if (criterion.metric === 'cardio_distance') value = distance > 0 ? distance : null
      if (criterion.metric === 'cardio_duration') value = duration > 0 ? duration : null
      if (criterion.metric === 'cardio_pace') value = distance > 0 && duration > 0 ? duration / distance : null
      if (criterion.metric === 'cardio_distance_time') {
        value = distance > 0 && duration > 0 ? distance : null
        secondaryValue = duration > 0 ? duration : undefined
      }
    }
    if (value !== null && Number.isFinite(value)) {
      result.push({ entryId: workout.id, recordedOn: workout.workoutDate, value, secondaryValue })
    }
  }
  return result.sort((left, right) => left.recordedOn.localeCompare(right.recordedOn) || left.entryId.localeCompare(right.entryId))
}

function customObservations(criterion: GoalCriterion, entries: readonly ProgressEntry[], today: LocalDate): ObservationWithSecondary[] {
  return entries.flatMap((entry) => {
    if (entry.recordedOn > today) return []
    const item = entry.customMetrics.find((metric) => metric.metricId === criterion.customMetricId)
    return item && Number.isFinite(item.value)
      ? [{ entryId: entry.id, recordedOn: entry.recordedOn, value: item.value }]
      : []
  }).sort((left, right) => left.recordedOn.localeCompare(right.recordedOn) || left.entryId.localeCompare(right.entryId))
}

function regularityObservations(criterion: GoalCriterion, workouts: readonly Workout[], periodStart: LocalDate, today: LocalDate): ObservationWithSecondary[] {
  const completed = confirmedWorkouts(workouts, criterion, today)
  const start = criterion.regularityPeriod === 'month' ? startOfMonth(periodStart) : startOfWeek(periodStart)
  const currentStart = criterion.regularityPeriod === 'month' ? startOfMonth(today) : startOfWeek(today)
  const dates = new Map<string, number>()
  for (const workout of completed) {
    const bucket = criterion.regularityPeriod === 'month' ? startOfMonth(workout.workoutDate) : startOfWeek(workout.workoutDate)
    if (bucket >= start) dates.set(bucket, (dates.get(bucket) ?? 0) + 1)
  }
  const observations: ObservationWithSecondary[] = []
  let cursor = start
  while (cursor <= currentStart) {
    const end = criterion.regularityPeriod === 'month' ? endOfMonth(cursor) : endOfWeek(cursor)
    // A strict "each period" verdict only includes completed calendar periods.
    if (criterion.regularityMode !== 'each_period' || end < today) {
      observations.push({ entryId: `regularity:${cursor}`, recordedOn: end < today ? end : today, value: dates.get(cursor) ?? 0 })
    }
    cursor = criterion.regularityPeriod === 'month' ? startOfMonth(addDays(end, 1)) : addDays(end, 1)
  }
  return observations
}

function distanceToTarget(value: number, criterion: GoalCriterion, absoluteTarget: number | null): number {
  if (criterion.operation === 'maintain_range') {
    return value < (criterion.rangeMin ?? 0) ? (criterion.rangeMin ?? 0) - value
      : value > (criterion.rangeMax ?? 0) ? value - (criterion.rangeMax ?? 0) : 0
  }
  if (absoluteTarget === null) return 0
  const decreasing = criterion.operation === 'decrease_to'
    || (criterion.operation === 'change_by' && (criterion.targetValue ?? 0) < 0)
    || criterion.metric === 'cardio_pace'
  return decreasing ? Math.max(0, value - absoluteTarget) : Math.max(0, absoluteTarget - value)
}

function calculateFromObservations(criterion: GoalCriterion, observations: readonly ObservationWithSecondary[], periodStart: LocalDate, periodEnd: LocalDate, today: LocalDate): GoalCriterionProgress {
  const latestNow = observations.at(-1) ?? null
  const periodEndValue = observations.filter((item) => item.recordedOn <= periodEnd).at(-1) ?? null
  const inPeriod = observations.filter((item) => item.recordedOn >= periodStart && item.recordedOn <= periodEnd)
  const first = inPeriod[0] ?? null
  const last = inPeriod.at(-1) ?? null
  const absoluteTarget = criterion.operation === 'change_by'
    ? criterion.baselineValue === null ? null : criterion.baselineValue + (criterion.targetValue ?? 0)
    : criterion.operation === 'maintain_range' || criterion.operation === 'track_only' ? null : criterion.targetValue
  let status: GoalProgressStatus = latestNow ? 'tracking' : 'needs_data'
  if (latestNow && criterion.operation === 'change_by' && absoluteTarget === null) status = 'needs_baseline'
  else if (latestNow && criterion.operation === 'maintain_range') {
    status = latestNow.value >= (criterion.rangeMin ?? 0) && latestNow.value <= (criterion.rangeMax ?? 0) ? 'in_range_now' : 'outside_range'
  } else if (latestNow && criterion.operation !== 'track_only') {
    const secondaryMet = criterion.metric !== 'cardio_distance_time'
      || (latestNow.secondaryValue ?? Number.POSITIVE_INFINITY) <= (criterion.secondaryTargetValue ?? Number.NEGATIVE_INFINITY)
    status = distanceToTarget(latestNow.value, criterion, absoluteTarget) <= TRAINING_GOAL_PROGRESS_POLICY.comparisonEpsilon && secondaryMet
      ? 'target_reached' : 'target_not_reached'
  }
  let direction: GoalProgressDirection = 'insufficient_data'
  if (first && last && first.entryId !== last.entryId) {
    const delta = last.value - first.value
    if (criterion.operation === 'track_only') direction = Math.abs(delta) <= TRAINING_GOAL_PROGRESS_POLICY.comparisonEpsilon ? 'unchanged' : delta > 0 ? 'increased' : 'decreased'
    else {
      const before = distanceToTarget(first.value, criterion, absoluteTarget)
      const after = distanceToTarget(last.value, criterion, absoluteTarget)
      direction = Math.abs(after - before) <= TRAINING_GOAL_PROGRESS_POLICY.comparisonEpsilon ? 'stable' : after < before ? 'toward_target' : 'away_from_target'
    }
  }
  const ageDays = latestNow ? daysBetween(latestNow.recordedOn, today) : null
  return {
    status,
    current: latestNow,
    periodEnd: periodEndValue,
    latestNow,
    hasNewerValueAfterPeriod: Boolean(latestNow && latestNow.recordedOn > periodEnd),
    absoluteTarget,
    secondaryCurrent: latestNow?.secondaryValue ?? null,
    dynamics: { first, last, count: inPeriod.length, delta: first && last && first.entryId !== last.entryId ? last.value - first.value : null, direction },
    sufficiency: latestNow === null ? 'none' : inPeriod.length >= 2 ? 'enough_for_dynamics' : 'position_only',
    freshness: ageDays === null ? 'no_data' : ageDays <= TRAINING_GOAL_PROGRESS_POLICY.freshnessDays ? 'fresh' : 'stale',
    ageDays,
    sourceState: 'available',
  }
}

export function calculateTrainingGoalProgress(
  criterion: GoalCriterion,
  workouts: readonly Workout[],
  entries: readonly ProgressEntry[],
  periodStart: LocalDate,
  periodEnd: LocalDate,
  today: LocalDate,
  sourceExists = true,
): GoalCriterionProgress {
  if (criterion.metric === 'weight' || criterion.metric === 'waist' || criterion.metric === 'chest' || criterion.metric === 'hips') {
    throw new Error('training_goal_metric_required')
  }
  const observations = criterion.metric === 'custom'
    ? customObservations(criterion, entries, today)
    : criterion.metric === 'workout_regularity'
      ? regularityObservations(criterion, workouts, periodStart, today)
      : exerciseObservations(criterion, workouts, today)
  const result = calculateFromObservations(criterion, observations, periodStart, periodEnd, today)
  if (!sourceExists) return { ...result, status: 'needs_data', sourceState: 'deleted' }
  if (criterion.metric === 'workout_regularity') {
    const target = criterion.targetValue ?? Number.POSITIVE_INFINITY
    const values = observations.map((item) => item.value)
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
    const allMet = values.length > 0 && values.every((value) => value >= target)
    const met = criterion.regularityMode === 'each_period' ? allMet : average !== null && average >= target
    const current = average === null ? null : { entryId: 'regularity:average', recordedOn: today, value: average }
    return {
      ...result,
      status: average === null ? 'needs_data' : criterion.operation === 'track_only' ? 'tracking' : met ? 'target_reached' : 'target_not_reached',
      current,
      latestNow: current,
      secondaryCurrent: null,
      freshness: average === null ? 'no_data' : 'fresh',
      ageDays: average === null ? null : 0,
      regularity: { completedPeriods: values.filter((value) => value >= target).length, totalPeriods: values.length, mode: criterion.regularityMode ?? 'average' },
    }
  }
  return { ...result, sourceState: observations.length ? 'available' : 'missing' }
}
