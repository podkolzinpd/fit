export type SummaryWorkoutRow = {
  id: string
  workout_date: string | null
  status: string
  deleted_at: string | null
}

export type CompletedSummaryWorkoutRow = SummaryWorkoutRow & { workout_date: string }

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Defense in depth for the analytics source. The database query applies the
 * same conditions, but this keeps malformed rows from corrupting the prompt
 * if a view or a future query changes its shape.
 */
export function completedWorkoutsInPeriod(
  rows: SummaryWorkoutRow[],
  periodStart: string,
  periodEnd: string,
): CompletedSummaryWorkoutRow[] {
  return rows.filter((workout): workout is CompletedSummaryWorkoutRow =>
    workout.status === "done" &&
    workout.deleted_at === null &&
    typeof workout.workout_date === "string" &&
    LOCAL_DATE.test(workout.workout_date) &&
    workout.workout_date >= periodStart &&
    workout.workout_date <= periodEnd
  )
}
