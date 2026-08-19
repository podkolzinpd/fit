const DAY_MS = 86_400_000

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      DAY_MS,
  )
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}

function isoWeekKey(date: string): string {
  const value = new Date(`${date}T00:00:00Z`)
  const day = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1))
  const week = Math.ceil(
    ((value.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
  )
  return `${value.getUTCFullYear()}-${String(week).padStart(2, "0")}`
}

export function buildSummaryConsistency(
  workoutDates: readonly string[],
  requestedStart: string,
  periodEnd: string,
  firstCompletedWorkoutDate: string | null,
) {
  const dates = [...workoutDates].sort()
  const observationStart = firstCompletedWorkoutDate &&
      firstCompletedWorkoutDate > requestedStart
    ? firstCompletedWorkoutDate
    : requestedStart
  const observationDays = Math.max(daysBetween(observationStart, periodEnd) + 1, 1)
  // В первые дни не превращаем пару тренировок в искусственные 4–7 занятий
  // в неделю. После первой недели частота считается по всему реальному окну.
  const rateDays = Math.max(observationDays, 7)
  const gaps = dates.slice(1).map((date, index) =>
    daysBetween(dates[index] ?? date, date)
  )
  const lastDate = dates.at(-1)
  if (lastDate) gaps.push(daysBetween(lastDate, periodEnd))

  return {
    completed_workouts: dates.length,
    workouts_per_week: rounded((dates.length * 7) / rateDays),
    active_weeks: new Set(dates.map(isoWeekKey)).size,
    first_workout_date: dates[0] ?? null,
    last_workout_date: lastDate ?? null,
    longest_gap_days: gaps.length ? Math.max(...gaps) : null,
    observation_start: observationStart,
    observation_days: observationDays,
  }
}
