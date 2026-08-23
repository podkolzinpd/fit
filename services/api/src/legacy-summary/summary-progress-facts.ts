export type SummaryProgressMetric =
  | "max_weight"
  | "volume"
  | "total_reps"
  | "distance"
  | "duration"
  | "pace"

type SummaryProgressSession = {
  max_weight_kg?: number | undefined
  total_reps?: number | undefined
  volume_kg?: number | undefined
  total_duration_min?: number | undefined
  total_distance_km?: number | undefined
  pace_min_per_km?: number | undefined
}

export type SummaryProgressExercise = {
  name: string
  kind: string
  session_count: number
  first_session?: SummaryProgressSession | undefined
  last_session?: SummaryProgressSession | undefined
  change_percent?: Partial<Record<SummaryProgressMetric, number | undefined>> | undefined
}

export type SummaryProgressFactChange = {
  metric: SummaryProgressMetric
  from: number
  to: number
  change_percent: number
  favorable: boolean | null
}

export type SummaryProgressFact = {
  exercise_name: string
  kind: string
  session_count: number
  changes: SummaryProgressFactChange[]
}

const metricValue = {
  max_weight: "max_weight_kg",
  volume: "volume_kg",
  total_reps: "total_reps",
  distance: "total_distance_km",
  duration: "total_duration_min",
  pace: "pace_min_per_km",
} as const satisfies Record<SummaryProgressMetric, keyof SummaryProgressSession>

const metricPriority: Record<string, readonly SummaryProgressMetric[]> = {
  strength: ["max_weight", "volume", "total_reps"],
  distance: ["distance", "pace", "duration"],
  reps: ["total_reps", "duration"],
  duration: ["duration"],
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}

function factChange(
  exercise: SummaryProgressExercise,
  metric: SummaryProgressMetric,
): SummaryProgressFactChange | null {
  const key = metricValue[metric]
  const from = exercise.first_session?.[key]
  const to = exercise.last_session?.[key]
  const changePercent = exercise.change_percent?.[metric]
  if (
    typeof from !== "number" || !Number.isFinite(from) || from <= 0 ||
    typeof to !== "number" || !Number.isFinite(to) || to <= 0 ||
    typeof changePercent !== "number" || !Number.isFinite(changePercent) ||
    changePercent === 0
  ) return null

  const favorable = metric === "pace"
    ? changePercent < 0
    : metric === "duration"
      ? null
      : changePercent > 0

  return {
    metric,
    from: rounded(from),
    to: rounded(to),
    change_percent: Math.round(changePercent),
    favorable,
  }
}

/**
 * Builds a short, deterministic set of comparable facts for display.
 * The LLM receives the same source aggregates, but never has to recalculate
 * these values or percentages for the UI.
 */
export function buildSummaryProgressFacts(
  exercises: readonly SummaryProgressExercise[],
  limit = 4,
): SummaryProgressFact[] {
  return exercises
    .flatMap((exercise): SummaryProgressFact[] => {
      if (exercise.session_count < 2) return []
      const priority = metricPriority[exercise.kind] ?? ["max_weight", "volume", "total_reps"]
      const changes = priority
        .map((metric) => factChange(exercise, metric))
        .filter((change): change is SummaryProgressFactChange => change !== null)
        .slice(0, 2)
      return changes.length === 0 ? [] : [{
        exercise_name: exercise.name,
        kind: exercise.kind,
        session_count: exercise.session_count,
        changes,
      }]
    })
    .sort((left, right) => {
      const leftFavorable = left.changes.some((change) => change.favorable) ? 1 : 0
      const rightFavorable = right.changes.some((change) => change.favorable) ? 1 : 0
      const leftChange = Math.max(...left.changes.map((change) => Math.abs(change.change_percent)))
      const rightChange = Math.max(...right.changes.map((change) => Math.abs(change.change_percent)))
      return rightFavorable - leftFavorable ||
        right.session_count - left.session_count ||
        rightChange - leftChange ||
        left.exercise_name.localeCompare(right.exercise_name, "ru")
    })
    .slice(0, Math.max(0, limit))
}
