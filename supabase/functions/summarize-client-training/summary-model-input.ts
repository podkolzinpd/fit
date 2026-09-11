type SummarySession = {
  date?: unknown
  set_count?: unknown
  planned_set_count?: unknown
  set_completion_percent?: unknown
  planned_max_weight_kg?: unknown
  planned_total_reps?: unknown
  planned_volume_kg?: unknown
  max_weight_kg?: unknown
  total_reps?: unknown
  volume_kg?: unknown
  total_duration_min?: unknown
  total_distance_km?: unknown
  pace_min_per_km?: unknown
  average_rpe?: unknown
  sets?: SummarySet[]
}

export const SUMMARY_AGGREGATOR_VERSION = "summary-aggregate-v1"

const MAX_EXERCISE_CONTROL_POINTS = 8
const MAX_MEASUREMENT_CONTROL_POINTS = 8

type SummarySet = {
  exercise_position: number
  set_position: number
  planned: Record<string, unknown> | null
  performed: Record<string, unknown> | null
}

type SummaryExercise = {
  ref?: string
  name: string
  kind: string
  muscle_group?: string
  source?: string
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
  id?: unknown
  recorded_on?: unknown
  weight_kg?: unknown
  chest_cm?: unknown
  waist_cm?: unknown
  hip_cm?: unknown
  custom_metrics?: SummaryCustomMeasurement[]
}

type SummaryCustomMeasurement = {
  metric_id?: unknown
  name?: unknown
  unit?: unknown
  value?: unknown
}

type MeasurementChange = {
  metric: "weight_kg" | "chest_cm" | "waist_cm" | "hip_cm" | "custom"
  metric_id?: string
  name?: string
  unit?: string | null
  from: number
  to: number
  change: number
  first_date?: unknown
  last_date?: unknown
  evidence_points: number
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}

function sameLoad(left: number, right: number): boolean {
  return Math.abs(left - right) / Math.max(left, right, 1) <= 0.02
}

const MEASUREMENT_METRICS = ["weight_kg", "chest_cm", "waist_cm", "hip_cm"] as const

export function deriveMeasurementChanges(measurements: SummaryMeasurement[]): MeasurementChange[] {
  const standardChanges = MEASUREMENT_METRICS.flatMap((metric) => {
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
  const customPoints = new Map<string, Array<{ date: unknown; value: number; name: string; unit: string | null }>>()
  for (const measurement of measurements) {
    for (const custom of measurement.custom_metrics ?? []) {
      const metricId = typeof custom.metric_id === "string" ? custom.metric_id : ""
      const name = typeof custom.name === "string" ? custom.name.trim() : ""
      const value = finite(custom.value)
      if (!metricId || !name || value === undefined) continue
      const unit = typeof custom.unit === "string" ? custom.unit : null
      const points = customPoints.get(metricId) ?? []
      points.push({ date: measurement.recorded_on, value, name, unit })
      customPoints.set(metricId, points)
    }
  }
  const customChanges = [...customPoints.entries()].flatMap(([metricId, points]): MeasurementChange[] => {
    const first = points[0]
    const last = points.at(-1)
    if (!first || !last || points.length < 2 || first.value === last.value) return []
    return [{
      metric: "custom",
      metric_id: metricId,
      name: last.name,
      unit: last.unit,
      from: rounded(first.value),
      to: rounded(last.value),
      change: rounded(last.value - first.value),
      first_date: first.date,
      last_date: last.date,
      evidence_points: points.length,
    }]
  })
  return [...standardChanges, ...customChanges]
}

function evenlySpacedIndices(length: number, limit: number): number[] {
  if (length <= limit) return Array.from({ length }, (_, index) => index)
  return [...new Set(Array.from({ length: limit }, (_, index) =>
    Math.round((index * (length - 1)) / (limit - 1))))]
}

function measurementPoint(measurement: SummaryMeasurement) {
  return {
    recorded_on: measurement.recorded_on,
    weight_kg: measurement.weight_kg,
    chest_cm: measurement.chest_cm,
    waist_cm: measurement.waist_cm,
    hip_cm: measurement.hip_cm,
    custom_metrics: measurement.custom_metrics ?? [],
  }
}

function measurementContext(measurements: SummaryMeasurement[] | undefined) {
  const recent = measurements ?? []
  const indices = evenlySpacedIndices(recent.length, MAX_MEASUREMENT_CONTROL_POINTS)
  return {
    entry_count: recent.length,
    control_points: indices.map((index) => measurementPoint(recent[index]!)),
    changes: deriveMeasurementChanges(recent),
  }
}

function measurementComparison(
  current: SummaryMeasurement[] | undefined,
  previous: SummaryMeasurement[] | undefined,
): MeasurementChange[] {
  const standardChanges = MEASUREMENT_METRICS.flatMap((metric) => {
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
  const latestCustom = (values: SummaryMeasurement[] | undefined) => {
    const result = new Map<string, { date: unknown; value: number; name: string; unit: string | null }>()
    for (const measurement of values ?? []) {
      for (const custom of measurement.custom_metrics ?? []) {
        const metricId = typeof custom.metric_id === "string" ? custom.metric_id : ""
        const name = typeof custom.name === "string" ? custom.name.trim() : ""
        const value = finite(custom.value)
        if (metricId && name && value !== undefined) {
          result.set(metricId, { date: measurement.recorded_on, value, name, unit: typeof custom.unit === "string" ? custom.unit : null })
        }
      }
    }
    return result
  }
  const currentCustom = latestCustom(current)
  const previousCustom = latestCustom(previous)
  const customChanges = [...currentCustom.entries()].flatMap(([metricId, currentPoint]): MeasurementChange[] => {
    const previousPoint = previousCustom.get(metricId)
    if (!previousPoint || previousPoint.value === currentPoint.value) return []
    return [{
      metric: "custom",
      metric_id: metricId,
      name: currentPoint.name,
      unit: currentPoint.unit,
      from: rounded(previousPoint.value),
      to: rounded(currentPoint.value),
      change: rounded(currentPoint.value - previousPoint.value),
      first_date: previousPoint.date,
      last_date: currentPoint.date,
      evidence_points: 2,
    }]
  })
  return [...standardChanges, ...customChanges]
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

function sessionSnapshot(session: SummarySession | undefined) {
  if (!session) return null
  return {
    date: session.date,
    sets: session.set_count,
    plan_sets: session.planned_set_count,
    done_percent: session.set_completion_percent,
    plan_weight_kg: session.planned_max_weight_kg,
    plan_reps: session.planned_total_reps,
    plan_volume_kg: session.planned_volume_kg,
    weight_kg: session.max_weight_kg,
    reps: session.total_reps,
    volume_kg: session.volume_kg,
    duration_min: session.total_duration_min,
    distance_km: session.total_distance_km,
    pace_min_per_km: session.pace_min_per_km,
    rpe: session.average_rpe,
  }
}

function exerciseControlPoints(sessions: SummarySession[]): Array<ReturnType<typeof sessionSnapshot>> {
  if (sessions.length <= MAX_EXERCISE_CONTROL_POINTS) return sessions.map(sessionSnapshot)

  const preferred = new Set([0, sessions.length - 1])
  const metrics: Array<keyof SummarySession> = [
    "max_weight_kg", "volume_kg", "total_reps", "total_distance_km",
  ]
  for (const metric of metrics) {
    let bestIndex: number | null = null
    let bestValue = Number.NEGATIVE_INFINITY
    sessions.forEach((session, index) => {
      const value = finite(session[metric])
      if (value !== undefined && value > bestValue) {
        bestValue = value
        bestIndex = index
      }
    })
    if (bestIndex !== null && preferred.size < MAX_EXERCISE_CONTROL_POINTS) preferred.add(bestIndex)
  }
  let bestPaceIndex: number | null = null
  let bestPace = Number.POSITIVE_INFINITY
  sessions.forEach((session, index) => {
    const value = finite(session.pace_min_per_km)
    if (value !== undefined && value < bestPace) {
      bestPace = value
      bestPaceIndex = index
    }
  })
  if (bestPaceIndex !== null && preferred.size < MAX_EXERCISE_CONTROL_POINTS) preferred.add(bestPaceIndex)
  for (const index of evenlySpacedIndices(sessions.length, MAX_EXERCISE_CONTROL_POINTS)) {
    if (preferred.size >= MAX_EXERCISE_CONTROL_POINTS) break
    preferred.add(index)
  }

  return [...preferred]
    .sort((left, right) => left - right)
    .map((index) => sessionSnapshot(sessions[index]))
}

function compactExercisePeriod(exercise: SummaryExercise | undefined) {
  if (!exercise) return null
  const sessions = exercise.sessions ?? []
  return {
    session_count: exercise.session_count,
    comparison_confidence: exercise.session_count >= 4 ? "high" : exercise.session_count >= 2 ? "medium" : "low",
    first_date: (exercise.first_session ?? sessions[0])?.date,
    latest_date: (exercise.last_session ?? sessions.at(-1))?.date,
    best: exercise.best,
    change_percent: exercise.change_percent,
    derived_observations: deriveExerciseObservations(exercise),
    control_points: exerciseControlPoints(sessions),
  }
}

function combinedExercises(current: SummaryExercise[], previous: SummaryExercise[]) {
  const currentByRef = new Map(current.map((exercise) => [exercise.ref ?? exercise.name, exercise]))
  const previousByRef = new Map(previous.map((exercise) => [exercise.ref ?? exercise.name, exercise]))
  const orderedRefs = [
    ...currentByRef.keys(),
    ...[...previousByRef.keys()].filter((ref) => !currentByRef.has(ref)),
  ]
  return orderedRefs.map((ref) => {
    const currentExercise = currentByRef.get(ref)
    const previousExercise = previousByRef.get(ref)
    const identity = currentExercise ?? previousExercise!
    return {
      ref: identity.ref,
      name: identity.name,
      kind: identity.kind,
      muscle_group: identity.muscle_group,
      source: identity.source,
      presence: currentExercise && previousExercise
        ? "both_periods"
        : currentExercise ? "current_only" : "previous_only",
      current: compactExercisePeriod(currentExercise),
      previous: compactExercisePeriod(previousExercise),
    }
  })
}

function compactFeedback(signals: unknown) {
  if (!Array.isArray(signals)) return []
  const grouped = new Map<string, Record<string, unknown>>()
  for (const value of signals) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    const signal = value as Record<string, unknown>
    const compact = {
      session_rpe: signal.session_rpe,
      wellbeing: signal.wellbeing,
      discomfort: signal.discomfort,
      client_comment: typeof signal.client_comment === "string"
        ? signal.client_comment.trim().slice(0, 160)
        : signal.client_comment,
    }
    const key = JSON.stringify(compact)
    const existing = grouped.get(key)
    if (existing) {
      existing.occurrences = Number(existing.occurrences ?? 1) + 1
      existing.last_date = signal.date
    } else {
      grouped.set(key, {
        first_date: signal.date,
        last_date: signal.date,
        occurrences: 1,
        ...compact,
      })
    }
  }
  return [...grouped.values()]
}

function coverage(exercises: SummaryExercise[]) {
  const sessions = exercises.flatMap((exercise) => exercise.sessions ?? [])
  return {
    exercises: exercises.length,
    sessions: sessions.length,
    sets: sessions.reduce((total, session) => total + (session.sets?.length ?? 0), 0),
  }
}

/**
 * Sends every unique exercise from both periods while replacing repetitive
 * session rows with first/latest/best/trend and at most eight representative
 * control points. Raw sets never leave the backend aggregator. input_coverage
 * records the exact source counts, so compaction is explicit rather than a
 * silent omission.
 */
export function buildSummaryModelInput(
  trainingData: SummaryTrainingData,
) {
  const previous = trainingData.previous_period
  return {
    aggregation_version: SUMMARY_AGGREGATOR_VERSION,
    input_coverage: {
      current: coverage(trainingData.exercises),
      previous: coverage(previous?.exercises ?? []),
      complete: true,
      representation: "all_unique_exercises_with_compact_session_evidence",
    },
    period: trainingData.period,
    consistency: trainingData.consistency,
    goal: trainingData.goal,
    feedback_signals: compactFeedback(trainingData.feedback_signals),
    measurements: {
      ...measurementContext(trainingData.measurements),
      compared_to_previous_period: measurementComparison(trainingData.measurements, previous?.measurements),
    },
    exercises: combinedExercises(trainingData.exercises, previous?.exercises ?? []),
    previous_period: previous ? {
      period: previous.period,
      consistency: previous.consistency,
      feedback_signals: compactFeedback(previous.feedback_signals),
      measurements: measurementContext(previous.measurements),
    } : null,
  }
}
