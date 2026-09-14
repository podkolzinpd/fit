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

export const SUMMARY_AGGREGATOR_VERSION = "summary-aggregate-v3"

export const MAX_SUMMARY_MODEL_INPUT_CHARS = 20_000
export const TARGET_SUMMARY_MODEL_INPUT_CHARS = 19_000
const MAX_EVIDENCE_EXERCISES = 18
const MAX_EXERCISE_CONTROL_POINTS = 4
const MAX_MEASUREMENT_CONTROL_POINTS = 8
const MAX_CUSTOM_METRICS_PER_POINT = 8
const MAX_MEASUREMENT_CHANGES = 16
const MAX_FEEDBACK_SIGNALS = 12

export function buildSummaryFingerprintPayload(input: {
  promptVersion: string
  analysisVersion: string
  modelId: string
  modelInput: unknown
}) {
  return {
    prompt_version: input.promptVersion,
    analysis_version: input.analysisVersion,
    aggregation_version: SUMMARY_AGGREGATOR_VERSION,
    model_id: input.modelId,
    model_input: input.modelInput,
  }
}

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

function boundedString(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, limit) : undefined
}

function compactRecord(
  value: unknown,
  keys: readonly string[],
  stringLimit = 80,
): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const result: Record<string, string | number | boolean | null> = {}
  for (const key of keys) {
    const item = source[key]
    if (typeof item === "number" && Number.isFinite(item)) result[key] = rounded(item)
    else if (typeof item === "boolean" || item === null) result[key] = item
    else {
      const text = boundedString(item, stringLimit)
      if (text !== undefined) result[key] = text
    }
  }
  return result
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
    custom_metrics: (measurement.custom_metrics ?? [])
      .slice(0, MAX_CUSTOM_METRICS_PER_POINT)
      .flatMap((metric) => {
        const metricId = boundedString(metric.metric_id, 80)
        const name = boundedString(metric.name, 80)
        const value = finite(metric.value)
        if (!metricId || !name || value === undefined) return []
        return [{
          metric_id: metricId,
          name,
          unit: boundedString(metric.unit, 24) ?? null,
          value: rounded(value),
        }]
      }),
  }
}

function compactMeasurementChanges(changes: MeasurementChange[]): MeasurementChange[] {
  return changes.slice(0, MAX_MEASUREMENT_CHANGES).map((change) => ({
    ...change,
    ...(change.metric_id ? { metric_id: change.metric_id.slice(0, 80) } : {}),
    ...(change.name ? { name: change.name.slice(0, 80) } : {}),
    ...(change.unit ? { unit: change.unit.slice(0, 24) } : {}),
  }))
}

function measurementContext(measurements: SummaryMeasurement[] | undefined) {
  const recent = measurements ?? []
  const indices = evenlySpacedIndices(recent.length, MAX_MEASUREMENT_CONTROL_POINTS)
  return {
    entry_count: recent.length,
    control_points: indices.map((index) => measurementPoint(recent[index]!)),
    changes: compactMeasurementChanges(deriveMeasurementChanges(recent)),
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

function exerciseControlPoints(
  sessions: SummarySession[],
  limit = MAX_EXERCISE_CONTROL_POINTS,
): Array<ReturnType<typeof sessionSnapshot>> {
  if (sessions.length <= limit) return sessions.map(sessionSnapshot)

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
    if (bestIndex !== null && preferred.size < limit) preferred.add(bestIndex)
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
  if (bestPaceIndex !== null && preferred.size < limit) preferred.add(bestPaceIndex)
  for (const index of evenlySpacedIndices(sessions.length, limit)) {
    if (preferred.size >= limit) break
    preferred.add(index)
  }

  return [...preferred]
    .sort((left, right) => left - right)
    .map((index) => sessionSnapshot(sessions[index]))
}

function compactExercisePeriod(
  exercise: SummaryExercise | undefined,
  controlPointLimit = 0,
) {
  if (!exercise) return null
  const sessions = exercise.sessions ?? []
  return {
    session_count: exercise.session_count,
    comparison_confidence: exercise.session_count >= 4 ? "high" : exercise.session_count >= 2 ? "medium" : "low",
    first_date: (exercise.first_session ?? sessions[0])?.date,
    latest_date: (exercise.last_session ?? sessions.at(-1))?.date,
    best: compactRecord(exercise.best, [
      "max_weight_kg", "volume_kg", "total_reps", "distance_km", "pace_min_per_km",
    ]),
    change_percent: compactRecord(exercise.change_percent, [
      "max_weight", "volume", "total_reps", "distance", "duration", "pace",
    ]),
    derived_observations: deriveExerciseObservations(exercise),
    ...(controlPointLimit > 0
      ? { control_points: exerciseControlPoints(sessions, controlPointLimit) }
      : {}),
  }
}

function exerciseEvidenceScore(exercise: SummaryExercise | undefined): number {
  if (!exercise) return 0
  const observations = deriveExerciseObservations(exercise).length
  const changes = Object.keys(exercise.change_percent ?? {}).length
  return exercise.session_count * 10 + observations * 20 + changes * 12
}

function detailedExercises(
  current: SummaryExercise[],
  previous: SummaryExercise[],
  refs: string[],
  controlPointLimit: number,
) {
  const currentByRef = new Map(current.map((exercise) => [exercise.ref ?? exercise.name, exercise]))
  const previousByRef = new Map(previous.map((exercise) => [exercise.ref ?? exercise.name, exercise]))
  return refs.map((ref) => {
    const currentExercise = currentByRef.get(ref)
    const previousExercise = previousByRef.get(ref)
    const identity = currentExercise ?? previousExercise!
    return {
      ref: boundedString(identity.ref, 120),
      name: boundedString(identity.name, 120) ?? "Упражнение",
      kind: boundedString(identity.kind, 32) ?? "unknown",
      muscle_group: boundedString(identity.muscle_group, 48),
      source: boundedString(identity.source, 32),
      presence: currentExercise && previousExercise
        ? "both_periods"
        : currentExercise ? "current_only" : "previous_only",
      current: compactExercisePeriod(currentExercise, controlPointLimit),
      previous: compactExercisePeriod(previousExercise, controlPointLimit),
    }
  })
}

type ExerciseIndexEntry = [
  name: string,
  kind: string,
  muscleGroup: string,
  presence: "both_periods" | "current_only" | "previous_only",
  currentSessions: number,
  previousSessions: number,
  observations: string,
]

function exerciseIndex(
  current: SummaryExercise[],
  previous: SummaryExercise[],
  refs: string[],
): ExerciseIndexEntry[] {
  const currentByRef = new Map(current.map((exercise) => [exercise.ref ?? exercise.name, exercise]))
  const previousByRef = new Map(previous.map((exercise) => [exercise.ref ?? exercise.name, exercise]))
  return refs.map((ref) => {
    const currentExercise = currentByRef.get(ref)
    const previousExercise = previousByRef.get(ref)
    const identity = currentExercise ?? previousExercise!
    const observations = [...new Set([
      ...deriveExerciseObservations(currentExercise ?? { name: "", kind: "", session_count: 0 }),
      ...deriveExerciseObservations(previousExercise ?? { name: "", kind: "", session_count: 0 }),
    ].map((item) => item.kind))].slice(0, 4).join("|")
    return [
      boundedString(identity.name, 120) ?? "Упражнение",
      boundedString(identity.kind, 32) ?? "unknown",
      boundedString(identity.muscle_group, 48) ?? "other",
      currentExercise && previousExercise
        ? "both_periods"
        : currentExercise ? "current_only" : "previous_only",
      currentExercise?.session_count ?? 0,
      previousExercise?.session_count ?? 0,
      observations,
    ]
  })
}

function incrementCount(counts: Map<string, number>, rawKey: unknown, fallback: string) {
  const key = boundedString(rawKey, 48) ?? fallback
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function sortedCounts(counts: Map<string, number>): Array<[string, number]> {
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
}

function exerciseRollup(current: SummaryExercise[], previous: SummaryExercise[]) {
  const currentByRef = new Map(current.map((exercise) => [exercise.ref ?? exercise.name, exercise]))
  const previousByRef = new Map(previous.map((exercise) => [exercise.ref ?? exercise.name, exercise]))
  const refs = [...new Set([...currentByRef.keys(), ...previousByRef.keys()])]
  const byKind = new Map<string, number>()
  const byMuscleGroup = new Map<string, number>()
  const byPresence = new Map<string, number>()
  const observations = new Map<string, number>()
  for (const ref of refs) {
    const currentExercise = currentByRef.get(ref)
    const previousExercise = previousByRef.get(ref)
    const identity = currentExercise ?? previousExercise!
    incrementCount(byKind, identity.kind, "unknown")
    incrementCount(byMuscleGroup, identity.muscle_group, "other")
    incrementCount(byPresence, currentExercise && previousExercise
      ? "both_periods"
      : currentExercise ? "current_only" : "previous_only", "unknown")
    for (const observation of [
      ...deriveExerciseObservations(currentExercise ?? { name: "", kind: "", session_count: 0 }),
      ...deriveExerciseObservations(previousExercise ?? { name: "", kind: "", session_count: 0 }),
    ]) incrementCount(observations, observation.kind, "unknown")
  }
  return {
    unique_exercises: refs.length,
    by_kind: sortedCounts(byKind),
    by_muscle_group: sortedCounts(byMuscleGroup),
    by_presence: sortedCounts(byPresence),
    derived_observations: sortedCounts(observations),
  }
}

function rankedEvidenceRefs(current: SummaryExercise[], previous: SummaryExercise[]): string[] {
  const currentByRef = new Map(current.map((exercise) => [exercise.ref ?? exercise.name, exercise]))
  const previousByRef = new Map(previous.map((exercise) => [exercise.ref ?? exercise.name, exercise]))
  return [...new Set([...currentByRef.keys(), ...previousByRef.keys()])]
    .map((ref, index) => ({
      ref,
      index,
      score: exerciseEvidenceScore(currentByRef.get(ref)) + exerciseEvidenceScore(previousByRef.get(ref)),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.ref)
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
        ? signal.client_comment.trim().slice(0, 120)
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
  return [...grouped.values()].slice(-MAX_FEEDBACK_SIGNALS)
}

function compactPeriod(value: unknown) {
  return compactRecord(value, ["start", "end", "days", "requested_start"], 24)
}

function compactConsistency(value: unknown) {
  return compactRecord(value, [
    "completed_workouts", "workouts_per_week", "active_weeks", "first_workout_date",
    "last_workout_date", "longest_gap_days", "observation_start", "observation_days",
  ], 24)
}

function compactGoal(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const goal = value as Record<string, unknown>
  const title = boundedString(goal.title, 320)
  if (!title) return null
  const stage = goal.current_stage && typeof goal.current_stage === "object" && !Array.isArray(goal.current_stage)
    ? goal.current_stage as Record<string, unknown>
    : null
  return {
    title,
    target_date: boundedString(goal.target_date, 24) ?? null,
    current_stage: stage ? {
      title: boundedString(stage.title, 240) ?? "Этап",
      starts_on: boundedString(stage.starts_on, 24) ?? null,
      ends_on: boundedString(stage.ends_on, 24) ?? null,
    } : null,
  }
}

function coverage(exercises: SummaryExercise[]) {
  const sessions = exercises.flatMap((exercise) => exercise.sessions ?? [])
  return {
    exercises: exercises.length,
    sessions: sessions.length,
    sets: sessions.reduce((total, session) => total + (session.sets?.length ?? 0), 0),
  }
}

/** Computes coverage across every exercise, keeps named compact evidence while
 * it fits, and always falls back to a complete rollup before a paid request.
 * Raw sets never leave the backend.
 */
export function buildSummaryModelInput(
  trainingData: SummaryTrainingData,
) {
  const previous = trainingData.previous_period
  const previousExercises = previous?.exercises ?? []
  const rankedRefs = rankedEvidenceRefs(trainingData.exercises, previousExercises)
  const shared = {
    aggregation_version: SUMMARY_AGGREGATOR_VERSION,
    input_coverage: {
      current: coverage(trainingData.exercises),
      previous: coverage(previous?.exercises ?? []),
      complete: true,
      representation: "ranked_exercise_evidence_with_complete_rollup",
    },
    period: compactPeriod(trainingData.period),
    consistency: compactConsistency(trainingData.consistency),
    goal: compactGoal(trainingData.goal),
    feedback_signals: compactFeedback(trainingData.feedback_signals),
    measurements: {
      ...measurementContext(trainingData.measurements),
      compared_to_previous_period: compactMeasurementChanges(
        measurementComparison(trainingData.measurements, previous?.measurements),
      ),
    },
    previous_period: previous ? {
      period: compactPeriod(previous.period),
      consistency: compactConsistency(previous.consistency),
      feedback_signals: compactFeedback(previous.feedback_signals),
      measurements: measurementContext(previous.measurements),
    } : null,
    exercise_index_schema: [
      "name", "kind", "muscle_group", "presence", "current_sessions",
      "previous_sessions", "derived_observation_kinds",
    ],
    exercise_rollup: exerciseRollup(trainingData.exercises, previousExercises),
  }

  for (let evidenceCount = Math.min(MAX_EVIDENCE_EXERCISES, rankedRefs.length); evidenceCount >= 0; evidenceCount -= 1) {
    const detailedRefs = rankedRefs.slice(0, evidenceCount)
    const indexedRefs = rankedRefs.slice(evidenceCount)
    const result = {
      ...shared,
      evidence_exercise_count: evidenceCount,
      exercise_index_count: indexedRefs.length,
      exercise_index_omitted_count: 0,
      exercises: detailedExercises(
        trainingData.exercises,
        previousExercises,
        detailedRefs,
        MAX_EXERCISE_CONTROL_POINTS,
      ),
      exercise_index: exerciseIndex(trainingData.exercises, previousExercises, indexedRefs),
    }
    if (JSON.stringify(result).length <= TARGET_SUMMARY_MODEL_INPUT_CHARS) return result
  }

  for (let indexCount = rankedRefs.length; indexCount >= 0;) {
    const indexedRefs = rankedRefs.slice(0, indexCount)
    const result = {
      ...shared,
      evidence_exercise_count: 0,
      exercise_index_count: indexedRefs.length,
      exercise_index_omitted_count: rankedRefs.length - indexedRefs.length,
      exercises: detailedExercises(trainingData.exercises, previousExercises, [], 0),
      exercise_index: exerciseIndex(trainingData.exercises, previousExercises, indexedRefs),
    }
    if (JSON.stringify(result).length <= TARGET_SUMMARY_MODEL_INPUT_CHARS) return result
    if (indexCount === 0) break
    indexCount = Math.max(0, indexCount - Math.max(1, Math.ceil(indexCount / 10)))
  }

  throw new Error("summary_aggregation_failed")
}
