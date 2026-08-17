import type { Database } from '../database.types'
import type { ExerciseProgressPage, ExerciseProgressSet, InputKind } from '../../shared/domain'
import { localDate } from '../../shared/local-date'

export type ExerciseProgressRow = Database['public']['Functions']['list_exercise_progress']['Returns'][number]

export const EXERCISE_PROGRESS_PAGE_SIZE = 20

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function exerciseProgressSets(value: unknown): ExerciseProgressSet[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    return [{
      weightKg: numberOrUndefined(row.weightKg),
      reps: numberOrUndefined(row.reps),
      durationSec: numberOrUndefined(row.durationSec),
      distanceKm: numberOrUndefined(row.distanceKm),
      rpe: numberOrUndefined(row.rpe),
    }]
  })
}

export function exerciseProgressPageFromRows(data: ExerciseProgressRow[]): ExerciseProgressPage {
  const rows = data.slice(0, EXERCISE_PROGRESS_PAGE_SIZE)
  const items = rows.map((row) => ({
    workoutId: row.workout_id,
    workoutDate: localDate(row.workout_date),
    completedAt: row.completed_at,
    exerciseName: row.exercise_name,
    inputKind: row.input_kind as InputKind,
    confirmedSetCount: row.confirmed_set_count,
    primaryValue: row.primary_value,
    previousPrimaryValue: row.previous_primary_value,
    primaryChange: row.primary_change,
    allTimePrimaryValue: row.all_time_primary_value,
    bestWeightKg: row.best_weight_kg,
    repsAtBestWeight: row.reps_at_best_weight,
    bestWeightReps: row.best_weight_reps,
    allTimeBestWeightKg: row.all_time_best_weight_kg,
    allTimeBestWeightReps: row.all_time_best_weight_reps,
    isPrimaryPr: row.is_primary_pr,
    isWeightPr: row.is_weight_pr,
    isWeightRepsPr: row.is_weight_reps_pr,
    trainerComment: row.trainer_comment,
    sets: exerciseProgressSets(row.sets),
  }))
  const last = items.at(-1)
  return {
    items,
    nextCursor: data.length > EXERCISE_PROGRESS_PAGE_SIZE && last
      ? { completedAt: last.completedAt, workoutId: last.workoutId }
      : null,
    totalCount: Number(data[0]?.total_count ?? 0),
  }
}
