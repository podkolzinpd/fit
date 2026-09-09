type SummarySession = {
  date?: unknown
  set_count?: unknown
  planned_set_count?: unknown
  set_completion_percent?: unknown
  planned_max_weight_kg?: unknown
  max_weight_kg?: unknown
  total_reps?: unknown
  volume_kg?: unknown
  total_duration_min?: unknown
  total_distance_km?: unknown
  pace_min_per_km?: unknown
  average_rpe?: unknown
}

type SummaryExercise = {
  name: string
  kind: string
  session_count: number
  first_session?: SummarySession | undefined
  last_session?: SummarySession | undefined
  change_percent?: Record<string, unknown>
  best?: unknown
  sessions?: SummarySession[]
}

type SummaryPeriodContext = {
  period: unknown
  consistency: unknown
  exercises: SummaryExercise[]
  feedback_signals?: unknown
  measurements?: SummaryMeasurement[]
}

type SummaryTrainingData = SummaryPeriodContext & {
  goal: unknown
  previous_period?: SummaryPeriodContext | null
}

type DerivedObservation = {
  kind: string
  evidence_sessions: number
  from?: number
  to?: number
}

type SummaryMeasurement = {
  recorded_on?: unknown
  weight_kg?: unknown
  chest_cm?: unknown
  waist_cm?: unknown
  hip_cm?: unknown
}

type MeasurementChange = {
  metric: "weight_kg" | "chest_cm" | "waist_cm" | "hip_cm"
  from: number
  to: number
  change: number
  first_date?: unknown
  last_date?: unknown
  evidence_points: number
}

const STOP_WORDS = new Set([
  'цель', 'этап', 'увеличить', 'улучшить', 'снизить', 'набрать', 'период',
  'текущий', 'текущая', 'текущем', 'килограмм', 'повторение', 'тренировка',
])

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}

function tokens(value: unknown): Set<string> {
  return new Set(JSON.stringify(value ?? '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .split(/[^а-яa-z0-9]+/u)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
    .map((word) => word.slice(0, 6)))
}

function sameLoad(left: number, right: number): boolean {
  return Math.abs(left - right) / Math.max(left, right, 1) <= 0.02
}

const MEASUREMENT_METRICS = ["weight_kg", "chest_cm", "waist_cm", "hip_cm"] as const

export function deriveMeasurementChanges(measurements: SummaryMeasurement[]): MeasurementChange[] {
  return MEASUREMENT_METRICS.flatMap((metric) => {
    const points = measurements
      .map((measurement) => ({ date: measurement.recorded_on, value: finite(measurement[metric]) }))
      .filter((point): point is { date: unknown; value: number } => point.value !== undefined)
    const first = points[0]
    const last = points.at(-1)
    if (!first || !last || points.length < 2 || first.value === last.value) return []
    return [{
      metric,
      from: rounded(first.value),
      to: rounded(last.value),
      change: rounded(last.value - first.value),
      first_date: first.date,
      last_date: last.date,
      evidence_points: points.length,
    }]
  })
}

function measurementContext(measurements: SummaryMeasurement[] | undefined) {
  const recent = (measurements ?? []).slice(-8)
  return {
    recent_entries: recent,
    changes: deriveMeasurementChanges(recent),
  }
}

function measurementComparison(
  current: SummaryMeasurement[] | undefined,
  previous: SummaryMeasurement[] | undefined,
): MeasurementChange[] {
  return MEASUREMENT_METRICS.flatMap((metric) => {
    const currentPoint = [...(current ?? [])].reverse()
      .map((measurement) => ({ date: measurement.recorded_on, value: finite(measurement[metric]) }))
      .find((point) => point.value !== undefined)
    const previousPoint = [...(previous ?? [])].reverse()
      .map((measurement) => ({ date: measurement.recorded_on, value: finite(measurement[metric]) }))
      .find((point) => point.value !== undefined)
    if (currentPoint?.value === undefined || previousPoint?.value === undefined || currentPoint.value === previousPoint.value) return []
    return [{
      metric,
      from: rounded(previousPoint.value),
      to: rounded(currentPoint.value),
      change: rounded(currentPoint.value - previousPoint.value),
      first_date: previousPoint.date,
      last_date: currentPoint.date,
      evidence_points: 2,
    }]
  })
}

export function deriveExerciseObservations(exercise: SummaryExercise): DerivedObservation[] {
  const sessions = (exercise.sessions ?? []).slice(-6)
  if (sessions.length < 2) return []
  const first = sessions[0] ?? {}
  const last = sessions.at(-1) ?? {}
  const observations: DerivedObservation[] = []

  if (exercise.kind === 'strength') {
    const firstWeight = finite(first.max_weight_kg)
    const lastWeight = finite(last.max_weight_kg)
    const firstReps = finite(first.total_reps)
    const lastReps = finite(last.total_reps)
    if (firstWeight !== undefined && lastWeight !== undefined && lastWeight > firstWeight) {
      observations.push({
        kind: firstReps !== undefined && lastReps !== undefined && lastReps < firstReps
          ? 'load_up_reps_down'
          : 'load_up_reps_held',
        evidence_sessions: sessions.length,
        from: rounded(firstWeight),
        to: rounded(lastWeight),
      })
    } else if (
      firstWeight !== undefined && lastWeight !== undefined && sameLoad(firstWeight, lastWeight) &&
      firstReps !== undefined && lastReps !== undefined && lastReps > firstReps
    ) {
      observations.push({
        kind: 'reps_up_at_same_load',
        evidence_sessions: sessions.length,
        from: rounded(firstReps),
        to: rounded(lastReps),
      })
    }

    const recentWeights = sessions.slice(-3)
      .map((session) => finite(session.max_weight_kg))
      .filter((value): value is number => value !== undefined)
    if (recentWeights.length === 3) {
      const upward = recentWeights[1]! >= recentWeights[0]! &&
        recentWeights[2]! >= recentWeights[1]! && recentWeights[2]! > recentWeights[0]!
      const downward = recentWeights[1]! <= recentWeights[0]! &&
        recentWeights[2]! <= recentWeights[1]! && recentWeights[2]! < recentWeights[0]!
      if (upward) observations.push({
        kind: 'repeated_load_growth',
        evidence_sessions: 3,
        from: rounded(recentWeights[0]!),
        to: rounded(recentWeights[2]!),
      })
      if (downward) observations.push({
        kind: 'repeated_load_decline',
        evidence_sessions: 3,
        from: rounded(recentWeights[0]!),
        to: rounded(recentWeights[2]!),
      })
    }

    const bestWeight = finite((exercise.best as { max_weight_kg?: unknown } | undefined)?.max_weight_kg)
    if (bestWeight !== undefined && lastWeight !== undefined && bestWeight > lastWeight) {
      observations.push({ kind: 'peak_not_repeated', evidence_sessions: sessions.length, from: rounded(bestWeight), to: rounded(lastWeight) })
    }
  }

  const firstSets = finite(first.set_count)
  const lastSets = finite(last.set_count)
  if (firstSets !== undefined && lastSets !== undefined && lastSets > firstSets) {
    observations.push({ kind: 'set_count_up', evidence_sessions: sessions.length, from: firstSets, to: lastSets })
  }
  const plannedSets = finite(last.planned_set_count)
  const completion = finite(last.set_completion_percent)
  if (plannedSets !== undefined && completion !== undefined && completion < 100) {
    observations.push({ kind: 'planned_sets_incomplete', evidence_sessions: 1, from: plannedSets, to: finite(last.set_count) ?? 0 })
  }
  const plannedWeight = finite(last.planned_max_weight_kg)
  const actualWeight = finite(last.max_weight_kg)
  if (plannedWeight !== undefined && actualWeight !== undefined && !sameLoad(plannedWeight, actualWeight)) {
    observations.push({
      kind: actualWeight > plannedWeight ? 'load_above_plan' : 'load_below_plan',
      evidence_sessions: 1,
      from: rounded(plannedWeight),
      to: rounded(actualWeight),
    })
  }

  return observations.slice(0, 4)
}

function exerciseScore(exercise: SummaryExercise, goalTokens: ReadonlySet<string>): number {
  const nameTokens = tokens(exercise.name)
  const goalMatch = [...nameTokens].some((word) => goalTokens.has(word)) ? 100 : 0
  const change = Object.values(exercise.change_percent ?? {})
    .map(finite)
    .filter((value): value is number => value !== undefined)
    .reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0)
  return goalMatch + Math.min(exercise.session_count, 12) * 4 +
    Math.min(change, 50) + deriveExerciseObservations(exercise).length * 12
}

function selectExercises(exercises: SummaryExercise[], goal: unknown, limit: number) {
  const goalTokens = tokens(goal)
  return exercises
    .map((exercise, index) => ({ exercise, index, score: exerciseScore(exercise, goalTokens) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, limit))
    .map(({ exercise }) => ({
      name: exercise.name,
      kind: exercise.kind,
      session_count: exercise.session_count,
      first_session: exercise.first_session,
      last_session: exercise.last_session,
      change_percent: exercise.change_percent,
      best: exercise.best,
      recent_sessions: (exercise.sessions ?? []).slice(-6),
      derived_observations: deriveExerciseObservations(exercise),
    }))
}

/**
 * Sends a bounded but chronological training picture to the model. Numeric
 * comparisons and trend candidates are computed before the LLM call; the model
 * interprets them and is not asked to invent or recalculate evidence.
 */
export function buildSummaryModelInput(
  trainingData: SummaryTrainingData,
  exerciseLimit = 12,
) {
  const previous = trainingData.previous_period
  return {
    period: trainingData.period,
    consistency: trainingData.consistency,
    goal: trainingData.goal,
    feedback_signals: trainingData.feedback_signals ?? [],
    measurements: {
      ...measurementContext(trainingData.measurements),
      compared_to_previous_period: measurementComparison(trainingData.measurements, previous?.measurements),
    },
    exercises: selectExercises(trainingData.exercises, trainingData.goal, exerciseLimit),
    previous_period: previous ? {
      period: previous.period,
      consistency: previous.consistency,
      feedback_signals: previous.feedback_signals ?? [],
      measurements: measurementContext(previous.measurements),
      exercises: selectExercises(previous.exercises, trainingData.goal, Math.min(8, exerciseLimit)),
    } : null,
  }
}
