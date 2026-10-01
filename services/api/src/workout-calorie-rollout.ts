import { createHash } from 'node:crypto'

interface CalorieShadowSegment {
  activity?: string
  speedKmh?: number | null
}

export interface WorkoutCalorieEstimateRow {
  id: string
  status: string
  active_calories_kcal: number | null
  calorie_v2_shadow_kcal: number | null
  calorie_v2_shadow_reason: string | null
  calorie_v2_shadow_details: { segments?: CalorieShadowSegment[] } | null
  calorie_v2_shadow_at: Date | null
}

export function calorieRolloutPercent(environment: NodeJS.ProcessEnv = process.env): number {
  const raw = environment.FIT_CALORIE_V2_ROLLOUT_PERCENT ?? '0'
  if (!/^(?:100|[0-9]|[1-9][0-9])$/u.test(raw)) {
    throw new Error('FIT_CALORIE_V2_ROLLOUT_PERCENT must be an integer from 0 to 100')
  }
  return Number(raw)
}

export function calorieRolloutBucket(workoutId: string): number {
  return createHash('sha256').update(workoutId).digest().readUInt32BE(0) % 100
}

export function publishedWorkoutCalories(row: WorkoutCalorieEstimateRow, rolloutPercent: number) {
  if (row.status !== 'done') return { kcal: null, version: null, basis: null, notice: null }
  // Legacy records have no shadow result. They remain untouched and visible.
  if (row.calorie_v2_shadow_at === null) return row.active_calories_kcal === null
    ? { kcal: null, version: null, basis: null, notice: null }
    : { kcal: row.active_calories_kcal, version: 1, basis: 'Приблизительно по данным тренировки', notice: null }
  // Even while v1 remains in control, an invalid or unmeasured cardio bout
  // must not leak its fabricated v1 number through the read model.
  if (row.calorie_v2_shadow_reason !== null) return {
    kcal: null, version: null, basis: null,
    notice: row.calorie_v2_shadow_reason === 'missing_activity_duration'
      ? 'Для оценки добавьте фактическое время кардио.'
      : row.calorie_v2_shadow_reason === 'missing_weight'
        ? 'Для оценки нужен вес на дату тренировки.'
        : 'Не хватает согласованных данных для оценки калорий.',
  }
  if (rolloutPercent > calorieRolloutBucket(row.id) && row.calorie_v2_shadow_kcal !== null) {
    const segments = row.calorie_v2_shadow_details?.segments ?? []
    const basis = segments.some((segment) => segment.speedKmh !== null && segment.speedKmh !== undefined)
      ? 'По фактическому времени и темпу'
      : segments.some((segment) => segment.activity && segment.activity !== 'strength' && segment.activity !== 'strength-heavy' && segment.activity !== 'strength-circuit')
        ? 'По фактическому времени; интенсивность приблизительная'
        : 'Приблизительно по выполненным подходам'
    return { kcal: row.calorie_v2_shadow_kcal, version: 2, basis, notice: null }
  }
  return row.active_calories_kcal === null
    ? { kcal: null, version: null, basis: null, notice: null }
    : { kcal: row.active_calories_kcal, version: 1, basis: 'Приблизительно по данным тренировки', notice: null }
}
