import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2.110.8"
import { withSupabase } from "@supabase/server"
import {
  PROMPT_VERSION,
  SUMMARY_CHUNK_JSON_SCHEMA,
  SUMMARY_CHUNK_SYSTEM_PROMPT,
  SUMMARY_ANALYSIS_VERSION,
  SUMMARY_JSON_SCHEMA,
  SUMMARY_SYSTEM_PROMPT,
} from "./summary-contract.ts"
import { summaryQualityIssues } from "./summary-quality.ts"
import { buildTrainingGoalContext } from "./summary-goal.ts"
import {
  authorizeSummaryActor,
  parseYandexJson,
} from "./self-service.ts"
import { completedWorkoutsInPeriod } from "./workout-source.ts"
import { buildSummaryConsistency } from "./summary-consistency.ts"
import { buildSummaryProgressFacts } from "./summary-progress-facts.ts"
import { buildSummaryModelInput } from "./summary-model-input.ts"
import { resolveSupabasePublicKey } from "./supabase-public-key.ts"

const YANDEX_COMPLETION_URL =
  "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
const MAX_PERIOD_DAYS = 366
const MAX_SOURCE_ROWS = 10_000
const MAX_DIRECT_MODEL_INPUT_CHARS = 80_000

type SummarizeRequest = {
  client_id: string
  period_start: string
  period_end: string
  force: boolean
}

type WorkoutRow = {
  id: string
  workout_date: string
  status: string
  deleted_at: string | null
  session_rpe: number | null
  wellbeing: string | null
  discomfort: boolean | null
  client_comment: string | null
}

type ExerciseRow = {
  id: string
  workout_id: string
  exercise_ref: string
  exercise_name: string
  exercise_source?: string
  muscle_group?: string
  input_kind: string
  position: number
}

type SetRow = {
  workout_exercise_id: string
  position: number
  plan_weight_kg: number | null
  plan_reps: number | null
  plan_duration_min: number | null
  plan_duration_sec: number | null
  plan_distance_km: number | null
  plan_rpe: number | null
  fact_weight_kg: number | null
  fact_reps: number | null
  fact_duration_min: number | null
  fact_duration_sec: number | null
  fact_distance_km: number | null
  fact_rpe: number | null
  confirmed_at: string | null
}

type ProgressRow = {
  id: string
  recorded_on: string
  weight_kg: number | null
  chest_cm: number | null
  waist_cm: number | null
  hip_cm: number | null
  custom_metrics?: Array<{
    metric_id: string
    name: string
    unit: string | null
    value: number
  }>
}

type CustomMetricRow = { id: string; name: string; unit: string | null }
type ProgressCustomRow = { progress_id: string; metric_id: string; value: number | string }

type YandexCompletionResponse = {
  result?: {
    alternatives?: Array<{
      message?: {
        text?: string
      }
      status?: string
    }>
    usage?: Record<string, string>
    modelVersion?: string
  }
}

type TrainerSummary = {
  headline: string
  progress: string[]
  consistency: string
  attention: string[]
}

type ClientSummary = {
  headline: string
  achievements: string[]
  consistency: string
  encouragement: string
  goalAlignment: string
  nextSteps: string[]
  missingContext: string[]
  analysisVersion: string
}

type GeneratedSummary = {
  trainer: TrainerSummary
  client: ClientSummary
}

type YandexSummaryResult = {
  summary: GeneratedSummary
  modelUri: string
  modelVersion: string | null
  usage: Record<string, string>
}

type ChunkAnalysis = {
  observations: string[]
  goal_evidence: string[]
  recovery_signals: string[]
  data_gaps: string[]
}

type YandexChunkResult = {
  analysis: ChunkAnalysis
  usage: Record<string, string>
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
}

function parseGeneratedSummary(value: string): GeneratedSummary {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new HttpError(502, "yandex_cloud_invalid_model_json")
  }

  if (!isRecord(parsed) || !isRecord(parsed.trainer) || !isRecord(parsed.client)) {
    throw new HttpError(502, "yandex_cloud_invalid_summary")
  }

  const trainer = parsed.trainer
  const client = parsed.client
  if (
    typeof trainer.headline !== "string" ||
    !isStringArray(trainer.progress) ||
    typeof trainer.consistency !== "string" ||
    !isStringArray(trainer.attention) ||
    typeof client.headline !== "string" ||
    !isStringArray(client.achievements) ||
    typeof client.consistency !== "string" ||
    typeof client.encouragement !== "string" ||
    typeof client.goalAlignment !== "string" ||
    !isStringArray(client.nextSteps)
    || !isStringArray(client.missingContext)
    || typeof client.analysisVersion !== "string"
  ) {
    throw new HttpError(502, "yandex_cloud_invalid_summary")
  }

  return {
    trainer: {
      headline: trainer.headline.trim(),
      progress: trainer.progress.map((item) => item.trim()),
      consistency: trainer.consistency.trim(),
      attention: trainer.attention.map((item) => item.trim()),
    },
    client: {
      headline: client.headline.trim(),
      achievements: client.achievements.map((item) => item.trim()),
      consistency: client.consistency.trim(),
      encouragement: client.encouragement.trim(),
      goalAlignment: client.goalAlignment.trim(),
      nextSteps: client.nextSteps.map((item) => item.trim()),
      missingContext: client.missingContext.map((item) => item.trim()),
      analysisVersion: client.analysisVersion.trim(),
    },
  }
}

function parseChunkAnalysis(value: string): ChunkAnalysis {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new HttpError(502, "yandex_cloud_invalid_model_json")
  }
  if (!isRecord(parsed)) {
    throw new HttpError(502, "yandex_cloud_invalid_summary")
  }
  const observations = parsed.observations
  const goalEvidence = parsed.goal_evidence
  const recoverySignals = parsed.recovery_signals
  const dataGaps = parsed.data_gaps
  if (
    !Array.isArray(observations) || observations.length > 6 || !observations.every((item) => typeof item === "string") ||
    !Array.isArray(goalEvidence) || goalEvidence.length > 3 || !goalEvidence.every((item) => typeof item === "string") ||
    !Array.isArray(recoverySignals) || recoverySignals.length > 2 || !recoverySignals.every((item) => typeof item === "string") ||
    !Array.isArray(dataGaps) || dataGaps.length > 1 || !dataGaps.every((item) => typeof item === "string")
  ) {
    throw new HttpError(502, "yandex_cloud_invalid_summary")
  }
  return {
    observations: observations.map((item) => item.trim()).filter(Boolean),
    goal_evidence: goalEvidence.map((item) => item.trim()).filter(Boolean),
    recovery_signals: recoverySignals.map((item) => item.trim()).filter(Boolean),
    data_gaps: dataGaps.map((item) => item.trim()).filter(Boolean),
  }
}

function trainerSummaryAsText(summary: TrainerSummary): string {
  const attention = summary.attention.length
    ? `\n\nНа что обратить внимание\n${summary.attention.map((item) => `- ${item}`).join("\n")}`
    : ""
  return [
    `Итог\n${summary.headline}`,
    `Прогресс\n${summary.progress.map((item) => `- ${item}`).join("\n")}`,
    `Регулярность\n${summary.consistency}${attention}`,
  ].join("\n\n")
}

function parseRequest(value: unknown): SummarizeRequest {
  if (!value || typeof value !== "object") {
    throw new HttpError(400, "request_body_required")
  }

  const body = value as Record<string, unknown>
  const clientId = body.client_id
  const periodStart = body.period_start
  const periodEnd = body.period_end
  const force = body.force
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const datePattern = /^\d{4}-\d{2}-\d{2}$/

  if (typeof clientId !== "string" || !uuidPattern.test(clientId)) {
    throw new HttpError(400, "invalid_client_id")
  }
  if (
    typeof periodStart !== "string" || !datePattern.test(periodStart) ||
    typeof periodEnd !== "string" || !datePattern.test(periodEnd)
  ) {
    throw new HttpError(400, "invalid_period")
  }
  if (force !== undefined && typeof force !== "boolean") {
    throw new HttpError(400, "invalid_force")
  }

  const startMs = Date.parse(`${periodStart}T00:00:00Z`)
  const endMs = Date.parse(`${periodEnd}T00:00:00Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new HttpError(400, "invalid_period")
  }
  if ((endMs - startMs) / 86_400_000 + 1 > MAX_PERIOD_DAYS) {
    throw new HttpError(400, "period_too_long")
  }

  return {
    client_id: clientId,
    period_start: periodStart,
    period_end: periodEnd,
    force: force === true,
  }
}

function requiredSecret(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new HttpError(500, `${name.toLowerCase()}_not_configured`)
  }
  return value
}

function serviceClient() {
  return createClient(
    requiredSecret("SUPABASE_URL"),
    requiredSecret("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
}

function requestClient(req: Request) {
  const authorization = req.headers.get("authorization")
  const publicKey = resolveSupabasePublicKey({
    publishableKey: Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
    publishableKeys: Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"),
    anonKey: Deno.env.get("SUPABASE_ANON_KEY"),
  })
  if (!publicKey) {
    throw new HttpError(500, "supabase_public_key_not_configured")
  }
  return createClient(
    requiredSecret("SUPABASE_URL"),
    publicKey,
    {
      global: {
        headers: authorization ? { Authorization: authorization } : {},
      },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

type SessionMetrics = {
  date: string
  set_count: number
  planned_set_count: number
  set_completion_percent: number
  planned_max_weight_kg?: number
  planned_total_reps?: number
  planned_volume_kg?: number
  max_weight_kg?: number
  total_reps?: number
  volume_kg?: number
  total_duration_min?: number
  total_distance_km?: number
  pace_min_per_km?: number
  average_rpe?: number
  sets: Array<{
    exercise_position: number
    set_position: number
    planned: Record<string, number> | null
    performed: Record<string, number> | null
  }>
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}

function percentChange(start?: number, end?: number): number | undefined {
  if (start === undefined || end === undefined || start <= 0) return undefined
  return Math.round(((end - start) / start) * 100)
}

function addUtcDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function inclusivePeriodDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000) + 1
}

function setValues(set: SetRow, kind: "plan" | "fact"): Record<string, number> | null {
  const values = {
    weight_kg: set[`${kind}_weight_kg`],
    reps: set[`${kind}_reps`],
    duration_min: set[`${kind}_duration_min`],
    duration_sec: set[`${kind}_duration_sec`],
    distance_km: set[`${kind}_distance_km`],
    rpe: set[`${kind}_rpe`],
  }
  const present = Object.entries(values).filter((entry): entry is [string, number] =>
    entry[1] !== null && Number.isFinite(Number(entry[1]))
  )
  return present.length > 0 ? Object.fromEntries(present.map(([key, value]) => [key, Number(value)])) : null
}

function buildProgressData(
  workouts: WorkoutRow[],
  exercises: ExerciseRow[],
  sets: SetRow[],
  periodStart: string,
  periodEnd: string,
  firstCompletedWorkoutDate: string | null,
) {
  const setsByExercise = new Map<string, SetRow[]>()
  for (const set of sets) {
    const current = setsByExercise.get(set.workout_exercise_id) ?? []
    current.push(set)
    setsByExercise.set(set.workout_exercise_id, current)
  }

  const workoutDateById = new Map(
    workouts.map((workout) => [workout.id, workout.workout_date]),
  )
  const exerciseProgress = new Map<string, {
    ref: string
    name: string
    kind: string
    muscle_group: string
    source: string
    sessions: Map<string, SessionMetrics>
  }>()

  for (const exercise of exercises) {
    const date = workoutDateById.get(exercise.workout_id)
    if (!date) continue

    const exerciseSets = setsByExercise.get(exercise.id) ?? []
    const confirmedSets = exerciseSets.filter((set) => set.confirmed_at !== null)
    const weights = confirmedSets.flatMap((set) =>
      set.fact_weight_kg === null ? [] : [Number(set.fact_weight_kg)]
    )
    const reps = confirmedSets.flatMap((set) =>
      set.fact_reps === null ? [] : [Number(set.fact_reps)]
    )
    const durations = confirmedSets.flatMap((set) => {
      if (set.fact_duration_sec !== null) return [Number(set.fact_duration_sec) / 60]
      return set.fact_duration_min === null ? [] : [Number(set.fact_duration_min)]
    })
    const distances = confirmedSets.flatMap((set) =>
      set.fact_distance_km === null ? [] : [Number(set.fact_distance_km)]
    )
    const rpes = confirmedSets.flatMap((set) =>
      set.fact_rpe === null ? [] : [Number(set.fact_rpe)]
    )
    const volume = confirmedSets.reduce(
      (sum, set) =>
        sum + (
          set.fact_weight_kg === null || set.fact_reps === null
            ? 0
            : Number(set.fact_weight_kg) * Number(set.fact_reps)
        ),
      0,
    )
    const plannedWeights = exerciseSets.flatMap((set) => set.plan_weight_kg === null ? [] : [Number(set.plan_weight_kg)])
    const plannedReps = exerciseSets.flatMap((set) => set.plan_reps === null ? [] : [Number(set.plan_reps)])
    const plannedVolume = exerciseSets.reduce((sum, set) =>
      sum + (set.plan_weight_kg === null || set.plan_reps === null ? 0 : Number(set.plan_weight_kg) * Number(set.plan_reps)), 0)

    const progress = exerciseProgress.get(exercise.exercise_ref) ?? {
      ref: exercise.exercise_ref,
      name: exercise.exercise_name,
      kind: exercise.input_kind,
      muscle_group: exercise.muscle_group ?? "other",
      source: exercise.exercise_source ?? "unknown",
      sessions: new Map<string, SessionMetrics>(),
    }
    const existing = progress.sessions.get(date)
    const session: SessionMetrics = {
      date,
      set_count: (existing?.set_count ?? 0) + confirmedSets.length,
      planned_set_count: (existing?.planned_set_count ?? 0) + exerciseSets.length,
      set_completion_percent: 0,
      sets: [
        ...(existing?.sets ?? []),
        ...exerciseSets.map((set) => ({
          exercise_position: exercise.position,
          set_position: set.position,
          planned: setValues(set, "plan"),
          performed: set.confirmed_at === null ? null : setValues(set, "fact"),
        })),
      ],
      planned_max_weight_kg: plannedWeights.length
        ? Math.max(existing?.planned_max_weight_kg ?? 0, ...plannedWeights)
        : existing?.planned_max_weight_kg,
      planned_total_reps: plannedReps.length
        ? rounded((existing?.planned_total_reps ?? 0) + plannedReps.reduce((a, b) => a + b, 0))
        : existing?.planned_total_reps,
      planned_volume_kg: plannedVolume > 0
        ? rounded((existing?.planned_volume_kg ?? 0) + plannedVolume)
        : existing?.planned_volume_kg,
      max_weight_kg: weights.length
        ? Math.max(existing?.max_weight_kg ?? 0, ...weights)
        : existing?.max_weight_kg,
      total_reps: reps.length
        ? rounded((existing?.total_reps ?? 0) + reps.reduce((a, b) => a + b, 0))
        : existing?.total_reps,
      volume_kg: volume > 0
        ? rounded((existing?.volume_kg ?? 0) + volume)
        : existing?.volume_kg,
      total_duration_min: durations.length
        ? rounded(
          (existing?.total_duration_min ?? 0) +
            durations.reduce((a, b) => a + b, 0),
        )
        : existing?.total_duration_min,
      total_distance_km: distances.length
        ? rounded(
          (existing?.total_distance_km ?? 0) +
            distances.reduce((a, b) => a + b, 0),
        )
        : existing?.total_distance_km,
      average_rpe: rpes.length
        ? rounded(rpes.reduce((a, b) => a + b, 0) / rpes.length)
        : existing?.average_rpe,
    }
    session.set_completion_percent = session.planned_set_count > 0
      ? Math.round((session.set_count / session.planned_set_count) * 100)
      : 100
    if (
      session.total_duration_min !== undefined &&
      session.total_distance_km !== undefined &&
      session.total_distance_km > 0
    ) {
      session.pace_min_per_km = rounded(
        session.total_duration_min / session.total_distance_km,
      )
    }
    progress.sessions.set(date, session)
    exerciseProgress.set(exercise.exercise_ref, progress)
  }

  const workoutDates = workouts
    .map((workout) => workout.workout_date)
    .sort()
  const consistency = buildSummaryConsistency(
    workoutDates,
    periodStart,
    periodEnd,
    firstCompletedWorkoutDate,
  )

  return {
    period: {
      start: consistency.observation_start,
      end: periodEnd,
      days: consistency.observation_days,
      requested_start: periodStart,
    },
    consistency,
    feedback_signals: workouts.flatMap((workout) => {
      const comment = workout.client_comment?.trim().slice(0, 240)
      if (
        workout.session_rpe === null && !workout.wellbeing &&
        workout.discomfort === null && !comment
      ) return []
      return [{
        date: workout.workout_date,
        session_rpe: workout.session_rpe,
        wellbeing: workout.wellbeing,
        discomfort: workout.discomfort,
        client_comment: comment || null,
      }]
    }),
    exercises: Array.from(exerciseProgress.values())
      .map((progress) => {
        const sessions = Array.from(progress.sessions.values())
          .sort((left, right) => left.date.localeCompare(right.date))
        const first = sessions[0]
        const last = sessions.at(-1)
        return {
          ref: progress.ref,
          name: progress.name,
          kind: progress.kind,
          muscle_group: progress.muscle_group,
          source: progress.source,
          session_count: sessions.length,
          first_session: first,
          last_session: last,
          change_percent: {
            max_weight: percentChange(
              first?.max_weight_kg,
              last?.max_weight_kg,
            ),
            volume: percentChange(first?.volume_kg, last?.volume_kg),
            total_reps: percentChange(first?.total_reps, last?.total_reps),
            distance: percentChange(
              first?.total_distance_km,
              last?.total_distance_km,
            ),
            duration: percentChange(
              first?.total_duration_min,
              last?.total_duration_min,
            ),
            pace: percentChange(
              first?.pace_min_per_km,
              last?.pace_min_per_km,
            ),
          },
          best: {
            max_weight_kg: sessions.reduce<number | undefined>(
              (best, session) =>
                session.max_weight_kg === undefined
                  ? best
                  : Math.max(best ?? session.max_weight_kg, session.max_weight_kg),
              undefined,
            ),
            volume_kg: sessions.reduce<number | undefined>(
              (best, session) =>
                session.volume_kg === undefined
                  ? best
                  : Math.max(best ?? session.volume_kg, session.volume_kg),
              undefined,
            ),
            total_reps: sessions.reduce<number | undefined>(
              (best, session) =>
                session.total_reps === undefined
                  ? best
                  : Math.max(best ?? session.total_reps, session.total_reps),
              undefined,
            ),
            distance_km: sessions.reduce<number | undefined>(
              (best, session) =>
                session.total_distance_km === undefined
                  ? best
                  : Math.max(
                    best ?? session.total_distance_km,
                    session.total_distance_km,
                  ),
              undefined,
            ),
            pace_min_per_km: sessions.reduce<number | undefined>(
              (best, session) =>
                session.pace_min_per_km === undefined
                  ? best
                  : Math.min(
                    best ?? session.pace_min_per_km,
                    session.pace_min_per_km,
                  ),
              undefined,
            ),
          },
          sessions,
        }
      })
      .sort((left, right) =>
        right.session_count - left.session_count ||
        left.name.localeCompare(right.name)
      ),
  }
}

type YandexRequestOptions = {
  skipChunking?: boolean
  qualityData?: unknown
  requestId?: string
  stage?: 'direct' | 'chunk' | 'synthesis'
  chunkIndex?: number
  chunkTotal?: number
}

function modelInputChunks(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.exercises)) return [value]
  const previous = isRecord(value.previous_period) ? value.previous_period : null
  const units = [
    ...value.exercises.map((exercise) => ({ period: 'current', exercise })),
    ...(Array.isArray(previous?.exercises)
      ? previous.exercises.map((exercise) => ({ period: 'previous', exercise }))
      : []),
  ]
  if (units.length === 0) return [value]

  const base = {
    ...value,
    input_coverage: isRecord(value.input_coverage)
      ? { ...value.input_coverage, complete: false }
      : { complete: false },
    chunk_scope: 'Это непересекающаяся часть полного входа. Найди локальные сигналы, не делай вывод о полноте всего периода.',
    exercises: [] as unknown[],
    previous_period: previous ? { ...previous, exercises: [] as unknown[] } : null,
  }
  const chunks: Array<typeof base> = []
  let chunk = structuredClone(base)
  for (const unit of units) {
    const target = unit.period === 'current'
      ? chunk.exercises
      : (chunk.previous_period?.exercises ?? chunk.exercises)
    target.push(unit.exercise)
    if (JSON.stringify(chunk).length > MAX_DIRECT_MODEL_INPUT_CHARS && target.length > 1) {
      target.pop()
      chunks.push(chunk)
      chunk = structuredClone(base)
      const nextTarget = unit.period === 'current'
        ? chunk.exercises
        : (chunk.previous_period?.exercises ?? chunk.exercises)
      nextTarget.push(unit.exercise)
    }
  }
  if (chunk.exercises.length > 0 || (chunk.previous_period?.exercises.length ?? 0) > 0) {
    chunks.push(chunk)
  }
  return chunks
}

function mergeUsage(results: Array<{ usage: Record<string, string> }>): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const result of results) {
    for (const [key, value] of Object.entries(result.usage)) {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) merged[key] = String(Number(merged[key] ?? 0) + numeric)
    }
  }
  return merged
}

type StructuredYandexConfig<T> = {
  systemPrompt: string
  schema: unknown
  maxTokens: string
  parse: (text: string) => T
  qualityIssues?: (value: T) => string[]
}

function yandexResponseError(status: number): HttpError {
  if (status === 408 || status === 504) return new HttpError(504, "yandex_cloud_timeout")
  if (status === 429) return new HttpError(503, "yandex_cloud_rate_limited")
  if (status >= 500) return new HttpError(502, "yandex_cloud_unavailable")
  if (status === 401 || status === 403) return new HttpError(502, "yandex_cloud_access_rejected")
  return new HttpError(502, "yandex_cloud_request_rejected")
}

function isRetryableYandexStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function yandexRetryDelay(attempt: number): number {
  return attempt === 1 ? 600 : 1_800
}

function structuredRetryLog(
  options: YandexRequestOptions,
  attempt: number,
  code: string,
  alternativeStatus: string | null,
  outputChars: number,
  completionTokens: string | null,
): void {
  console.warn("summary structured response retry", {
    request_id: options.requestId ?? null,
    stage: options.stage ?? 'direct',
    chunk_index: options.chunkIndex ?? null,
    chunk_total: options.chunkTotal ?? null,
    attempt,
    code,
    alternative_status: alternativeStatus,
    output_chars: outputChars,
    completion_tokens: completionTokens,
  })
}

async function requestStructuredYandex<T>(
  trainingData: unknown,
  periodStart: string,
  periodEnd: string,
  config: StructuredYandexConfig<T>,
  options: YandexRequestOptions,
): Promise<{ value: T; modelUri: string; modelVersion: string | null; usage: Record<string, string> }> {
  const apiKey = requiredSecret("YANDEX_CLOUD_API_KEY")
  const folderId = requiredSecret("YANDEX_CLOUD_FOLDER_ID")
  const modelId = Deno.env.get("YANDEX_CLOUD_MODEL_ID") ?? "yandexgpt"
  const modelUri = `gpt://${folderId}/${modelId}/latest`

  const messages = [
    { role: "system", text: config.systemPrompt },
    {
      role: "user",
      text: JSON.stringify({
        period: { start: periodStart, end: periodEnd },
        completed_workouts: trainingData,
      }),
    },
  ]
  const usage: Record<string, string> = {}
  let modelVersion: string | null = null

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    let response: Response
    try {
      response = await fetch(YANDEX_COMPLETION_URL, {
        method: "POST",
        headers: {
          "Authorization": `Api-Key ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          modelUri,
          completionOptions: {
            stream: false,
            temperature: attempt === 1 ? 0.2 : 0,
            maxTokens: config.maxTokens,
          },
          jsonSchema: { schema: config.schema },
          messages,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      const failure = error instanceof DOMException && error.name === "AbortError"
        ? new HttpError(504, "yandex_cloud_timeout")
        : new HttpError(502, "yandex_cloud_unavailable")
      if (attempt < 3) {
        structuredRetryLog(options, attempt, failure.message, null, 0, null)
        await new Promise((resolve) => setTimeout(resolve, yandexRetryDelay(attempt)))
        continue
      }
      throw failure
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const failure = yandexResponseError(response.status)
      if (attempt < 3 && isRetryableYandexStatus(response.status)) {
        structuredRetryLog(options, attempt, failure.message, null, 0, null)
        await new Promise((resolve) => setTimeout(resolve, yandexRetryDelay(attempt)))
        continue
      }
      throw failure
    }

    const payloadText = await response.text()
    let payload: YandexCompletionResponse
    try {
      payload = parseYandexJson<YandexCompletionResponse>(payloadText)
    } catch {
      const code = "yandex_cloud_invalid_upstream_json"
      if (attempt < 3) {
        structuredRetryLog(options, attempt, code, null, 0, null)
        continue
      }
      throw new HttpError(502, code)
    }
    const alternative = payload.result?.alternatives?.[0]
    const alternativeStatus = alternative?.status ?? null
    const text = alternative?.message?.text?.trim() ?? ""

    modelVersion = payload.result?.modelVersion ?? modelVersion
    for (const [key, value] of Object.entries(payload.result?.usage ?? {})) {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) {
        usage[key] = String(Number(usage[key] ?? 0) + numeric)
      }
    }
    const completionTokens = payload.result?.usage?.completionTokens ?? null
    if (
      alternativeStatus === "ALTERNATIVE_STATUS_TRUNCATED_FINAL" ||
      alternativeStatus === "ALTERNATIVE_STATUS_PARTIAL"
    ) {
      const code = "yandex_cloud_truncated_response"
      if (attempt < 3) {
        structuredRetryLog(options, attempt, code, alternativeStatus, text.length, completionTokens)
        messages.push({
          role: "user",
          text: "Предыдущий ответ оборвался по лимиту. Верни более короткий полный JSON без Markdown и пояснений.",
        })
        continue
      }
      throw new HttpError(502, code)
    }
    if (alternativeStatus === "ALTERNATIVE_STATUS_CONTENT_FILTER") {
      throw new HttpError(502, "yandex_cloud_request_rejected")
    }
    if (!text) {
      const code = "yandex_cloud_empty_response"
      if (attempt < 3) {
        structuredRetryLog(options, attempt, code, alternativeStatus, 0, completionTokens)
        continue
      }
      throw new HttpError(502, code)
    }

    let value: T
    try {
      value = config.parse(text)
    } catch (error) {
      const code = error instanceof HttpError
        ? error.message
        : "yandex_cloud_invalid_summary"
      if (attempt < 3) {
        structuredRetryLog(options, attempt, code, alternativeStatus, text.length, completionTokens)
        messages.push({
          role: "user",
          text: "Предыдущий ответ нельзя разобрать. Верни заново только полный корректный JSON по схеме, без Markdown и пояснений.",
        })
        continue
      }
      throw error instanceof HttpError ? error : new HttpError(502, code)
    }
    const issues = config.qualityIssues?.(value) ?? []
    if (issues.length === 0) {
      return { value, modelUri, modelVersion, usage }
    }
    console.warn("summary quality check rejected response", {
      request_id: options.requestId ?? null,
      stage: options.stage ?? 'direct',
      chunk_index: options.chunkIndex ?? null,
      chunk_total: options.chunkTotal ?? null,
      attempt,
      issue_count: issues.length,
      issues,
    })
    if (attempt === 3) {
      throw new HttpError(502, "yandex_cloud_quality_check_failed")
    }

    messages.push(
      { role: "assistant", text },
      {
        role: "user",
        text:
          "Предыдущий JSON не прошёл автоматическую проверку. Верни полный исправленный JSON. " +
          "Не меняй подтверждённые числа. Нарушения:\n- " +
          issues.join("\n- "),
      },
    )
  }

  throw new HttpError(502, "yandex_cloud_quality_check_failed")
}

async function requestYandexChunkAnalysis(
  trainingData: unknown,
  periodStart: string,
  periodEnd: string,
  options: YandexRequestOptions,
): Promise<YandexChunkResult> {
  const result = await requestStructuredYandex(trainingData, periodStart, periodEnd, {
    systemPrompt: SUMMARY_CHUNK_SYSTEM_PROMPT,
    schema: SUMMARY_CHUNK_JSON_SCHEMA,
    maxTokens: "900",
    parse: parseChunkAnalysis,
  }, options)
  return { analysis: result.value, usage: result.usage }
}

async function requestFinalYandexSummary(
  trainingData: unknown,
  periodStart: string,
  periodEnd: string,
  options: YandexRequestOptions,
): Promise<YandexSummaryResult> {
  const result = await requestStructuredYandex(trainingData, periodStart, periodEnd, {
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    schema: SUMMARY_JSON_SCHEMA,
    maxTokens: "2000",
    parse: parseGeneratedSummary,
    qualityIssues: (summary) => summaryQualityIssues(summary, options.qualityData ?? trainingData),
  }, options)
  return {
    summary: result.value,
    modelUri: result.modelUri,
    modelVersion: result.modelVersion,
    usage: result.usage,
  }
}

async function requestYandexSummary(
  trainingData: unknown,
  periodStart: string,
  periodEnd: string,
  options: YandexRequestOptions = {},
): Promise<YandexSummaryResult> {
  if (!options.skipChunking && JSON.stringify(trainingData).length > MAX_DIRECT_MODEL_INPUT_CHARS) {
    const chunks = modelInputChunks(trainingData)
    const partials: YandexChunkResult[] = []
    for (let offset = 0; offset < chunks.length; offset += 3) {
      const batch = chunks.slice(offset, offset + 3)
      partials.push(...await Promise.all(batch.map((chunk, batchIndex) => {
        const chunkIndex = offset + batchIndex + 1
        return requestYandexChunkAnalysis(chunk, periodStart, periodEnd, {
          ...options,
          requestId: `${options.requestId ?? 'summary'}-chunk-${chunkIndex}`,
          skipChunking: true,
          stage: 'chunk',
          chunkIndex,
          chunkTotal: chunks.length,
        })
      })))
    }
    const source = isRecord(trainingData) ? trainingData : {}
    const synthesisInput = {
      period: source.period,
      consistency: source.consistency,
      goal: source.goal,
      feedback_signals: source.feedback_signals,
      measurements: source.measurements,
      input_coverage: source.input_coverage,
      aggregation_note: 'Каждый элемент chunk_analyses содержит компактные доказательства из отдельной непересекающейся части полного списка упражнений.',
      chunk_analyses: partials.map((result) => result.analysis),
    }
    const final = await requestFinalYandexSummary(synthesisInput, periodStart, periodEnd, {
      ...options,
      requestId: `${options.requestId ?? 'summary'}-synthesis`,
      skipChunking: true,
      qualityData: trainingData,
      stage: 'synthesis',
    })
    return { ...final, usage: mergeUsage([...partials, final]) }
  }
  return requestFinalYandexSummary(trainingData, periodStart, periodEnd, {
    ...options,
    stage: options.stage ?? 'direct',
  })
}

const handler = withSupabase({ auth: "none" }, async (req, _ctx) => {
    const requestId = crypto.randomUUID()
    try {
      if (req.method !== "POST") {
        return Response.json(
          { error: "method_not_allowed" },
          { status: 405, headers: { "Allow": "POST" } },
        )
      }

      const input = parseRequest(await req.json())
      const userClient = requestClient(req)
      const { data: { user }, error: authError } = await userClient.auth.getUser()
      const actorId = user?.id
      console.log("summary auth diagnostics", {
        request_id: requestId,
        authorizationPresent: Boolean(req.headers.get("authorization")),
        actorIdPresent: Boolean(actorId),
        authError: authError?.message ?? null,
      })
      if (!actorId) {
        console.error("summary authentication_required", {
          authorizationPresent: Boolean(req.headers.get("authorization")),
          authError: authError?.message ?? null,
        })
        throw new HttpError(401, "authentication_required")
      }

      const { data: client, error: clientError } = await userClient
        .from("clients")
        .select("id,trainer_id,auth_user_id,goal")
        .eq("id", input.client_id)
        .is("archived_at", null)
        .maybeSingle()
      if (clientError) {
        throw new HttpError(500, "client_lookup_failed")
      }
      const { data: memberships, error: membershipsError } = await userClient
        .from("client_trainers")
        .select("trainer_id")
        .eq("client_id", input.client_id)
        .eq("trainer_id", actorId)
      if (membershipsError) {
        throw new HttpError(500, "client_memberships_lookup_failed")
      }
      const actor = authorizeSummaryActor(
        actorId,
        client,
        memberships?.map((membership) => membership.trainer_id) ?? [],
      )
      if (!actor) {
        throw new HttpError(404, "client_not_found")
      }
      const { isTrainer, isClient, isConnectedTrainer, trainerId } = actor

      const { data: structuredGoal, error: goalError } = await userClient
        .rpc("get_client_goal", { p_client_id: input.client_id })
      if (goalError) {
        throw new HttpError(500, "client_goal_lookup_failed")
      }
      const goalContext = buildTrainingGoalContext(
        client.goal,
        structuredGoal,
        input.period_end,
      )

      const { data: firstCompletedWorkout, error: firstCompletedWorkoutError } =
        await userClient
          .from("workouts")
          .select("workout_date")
          .eq("client_id", input.client_id)
          .eq("trainer_id", trainerId)
          .eq("status", "done")
          .is("deleted_at", null)
          .lte("workout_date", input.period_end)
          .order("workout_date")
          .limit(1)
          .maybeSingle()
      if (firstCompletedWorkoutError) {
        throw new HttpError(500, "first_workout_lookup_failed")
      }

      const periodDays = inclusivePeriodDays(input.period_start, input.period_end)
      const previousPeriodEnd = addUtcDays(input.period_start, -1)
      const previousPeriodStart = addUtcDays(previousPeriodEnd, -periodDays + 1)
      const { data: workouts, error: workoutsError } = await userClient
        .from("workouts")
        .select("id,workout_date,status,deleted_at,session_rpe,wellbeing,discomfort,client_comment")
        .eq("client_id", input.client_id)
        .eq("trainer_id", trainerId)
        .eq("status", "done")
        .is("deleted_at", null)
        .gte("workout_date", previousPeriodStart)
        .lte("workout_date", input.period_end)
        .order("workout_date")
        .limit(MAX_SOURCE_ROWS + 1)
      if (workoutsError) {
        throw new HttpError(500, "workouts_lookup_failed")
      }
      const completedWorkouts = completedWorkoutsInPeriod(
        workouts,
        input.period_start,
        input.period_end,
      )
      const previousWorkouts = completedWorkoutsInPeriod(
        workouts,
        previousPeriodStart,
        previousPeriodEnd,
      )
      if (completedWorkouts.length === 0) {
        throw new HttpError(422, "no_completed_workouts")
      }
      if (workouts.length > MAX_SOURCE_ROWS) {
        throw new HttpError(422, "source_row_limit_reached")
      }

      const { data: measurements, error: measurementsError } = await userClient
        .from("client_progress")
        .select("id,recorded_on,weight_kg,chest_cm,waist_cm,hip_cm")
        .eq("client_id", input.client_id)
        .eq("trainer_id", trainerId)
        .is("deleted_at", null)
        .gte("recorded_on", previousPeriodStart)
        .lte("recorded_on", input.period_end)
        .order("recorded_on")
        .limit(MAX_SOURCE_ROWS + 1)
      if (measurementsError) throw new HttpError(500, "measurements_lookup_failed")
      if (measurements.length > MAX_SOURCE_ROWS) throw new HttpError(422, "source_row_limit_reached")

      const progressIds = measurements.map((measurement) => measurement.id)
      let customMetrics: CustomMetricRow[] = []
      let customValues: ProgressCustomRow[] = []
      if (progressIds.length > 0) {
        const [{ data: metrics, error: metricsError }, { data: values, error: valuesError }] = await Promise.all([
          userClient
            .from("client_custom_metrics")
            .select("id,name,unit")
            .eq("client_id", input.client_id)
            .eq("trainer_id", trainerId)
            .order("name")
            .order("id")
            .limit(MAX_SOURCE_ROWS + 1),
          userClient
            .from("client_progress_custom")
            .select("progress_id,metric_id,value")
            .eq("client_id", input.client_id)
            .eq("trainer_id", trainerId)
            .in("progress_id", progressIds)
            .order("progress_id")
            .order("metric_id")
            .limit(MAX_SOURCE_ROWS + 1),
        ])
        if (metricsError || valuesError) throw new HttpError(500, "custom_measurements_lookup_failed")
        if (metrics.length > MAX_SOURCE_ROWS || values.length > MAX_SOURCE_ROWS) {
          throw new HttpError(422, "source_row_limit_reached")
        }
        customMetrics = metrics as CustomMetricRow[]
        customValues = values as ProgressCustomRow[]
      }
      const metricById = new Map(customMetrics.map((metric) => [metric.id, metric]))
      const valuesByProgress = new Map<string, ProgressRow["custom_metrics"]>()
      for (const row of customValues) {
        const metric = metricById.get(row.metric_id)
        const value = Number(row.value)
        if (!metric || !Number.isFinite(value)) continue
        const current = valuesByProgress.get(row.progress_id) ?? []
        current.push({ metric_id: metric.id, name: metric.name, unit: metric.unit, value })
        valuesByProgress.set(row.progress_id, current)
      }
      const enrichedMeasurements = (measurements as ProgressRow[]).map((measurement) => ({
        ...measurement,
        custom_metrics: valuesByProgress.get(measurement.id) ?? [],
      }))

      const workoutIds = [...completedWorkouts, ...previousWorkouts].map((workout) => workout.id)
      const { data: exercises, error: exercisesError } = await userClient
        .from("workout_exercises")
        .select("id,workout_id,exercise_source,exercise_ref,exercise_name,muscle_group,input_kind,position")
        .in("workout_id", workoutIds)
        .order("workout_id")
        .order("position")
        .order("id")
        .limit(MAX_SOURCE_ROWS + 1)
      if (exercisesError) {
        throw new HttpError(500, "exercises_lookup_failed")
      }
      if (exercises.length > MAX_SOURCE_ROWS) {
        throw new HttpError(422, "source_row_limit_reached")
      }

      const exerciseIds = exercises.map((exercise) => exercise.id)
      let sets: SetRow[] = []
      if (exerciseIds.length > 0) {
        const { data, error } = await userClient
          .from("workout_sets")
          .select(
            "workout_exercise_id,position,plan_weight_kg,plan_reps,plan_duration_min,plan_duration_sec,plan_distance_km,plan_rpe,fact_weight_kg,fact_reps,fact_duration_min,fact_duration_sec,fact_distance_km,fact_rpe,confirmed_at",
          )
          .in("workout_exercise_id", exerciseIds)
          .order("workout_exercise_id")
          .order("position")
          .order("id")
          .limit(MAX_SOURCE_ROWS + 1)
        if (error) {
          throw new HttpError(500, "sets_lookup_failed")
        }
        if (data.length > MAX_SOURCE_ROWS) {
          throw new HttpError(422, "source_row_limit_reached")
        }
        sets = data
      }

      const currentWorkoutIds = new Set(completedWorkouts.map((workout) => workout.id))
      const previousWorkoutIds = new Set(previousWorkouts.map((workout) => workout.id))
      const currentExercises = exercises.filter((exercise) => currentWorkoutIds.has(exercise.workout_id))
      const previousExercises = exercises.filter((exercise) => previousWorkoutIds.has(exercise.workout_id))
      const currentExerciseIds = new Set(currentExercises.map((exercise) => exercise.id))
      const previousExerciseIds = new Set(previousExercises.map((exercise) => exercise.id))
      const currentMeasurements = enrichedMeasurements
        .filter((item) => item.recorded_on >= input.period_start)
      const previousMeasurements = enrichedMeasurements
        .filter((item) => item.recorded_on <= previousPeriodEnd)
      const currentProgress = buildProgressData(
        completedWorkouts,
        currentExercises,
        sets.filter((set) => currentExerciseIds.has(set.workout_exercise_id)),
        input.period_start,
        input.period_end,
        firstCompletedWorkout?.workout_date ?? null,
      )
      const previousProgress = previousWorkouts.length > 0 || previousMeasurements.length > 0
        ? buildProgressData(
          previousWorkouts,
          previousExercises,
          sets.filter((set) => previousExerciseIds.has(set.workout_exercise_id)),
          previousPeriodStart,
          previousPeriodEnd,
          firstCompletedWorkout?.workout_date && firstCompletedWorkout.workout_date <= previousPeriodEnd
            ? firstCompletedWorkout.workout_date
            : null,
        )
        : null
      const trainingData = {
        ...currentProgress,
        goal: goalContext,
        measurements: currentMeasurements,
        previous_period: previousProgress ? {
          ...previousProgress,
          measurements: previousMeasurements,
        } : null,
      }
      const inputFingerprint = await fingerprint(trainingData)
      const modelInput = buildSummaryModelInput(trainingData)

      if (isClient && !input.force) {
        const { data: cached, error: cacheError } = await userClient
          .from("client_published_training_summaries")
          .select("id,source_summary_id,client_id,period_start,period_end,summary,display_metrics,generated_at,published_at")
          .eq("client_id", input.client_id)
          .eq("period_start", input.period_start)
          .eq("period_end", input.period_end)
          .maybeSingle()
        if (cacheError) throw new HttpError(500, "summary_cache_lookup_failed")
        const cachedSummary = cached?.summary && typeof cached.summary === "object" && !Array.isArray(cached.summary)
          ? cached.summary as Record<string, unknown>
          : null
        if (cached && cachedSummary?.analysisVersion === SUMMARY_ANALYSIS_VERSION && cachedSummary.inputFingerprint === inputFingerprint) {
          return Response.json({ data: cached, cached: true })
        }
      }

      if (isTrainer && !input.force) {
        const { data: cached, error: cacheError } = await userClient
          .from("client_training_summaries")
          .select(
            "id,client_id,period_start,period_end,trainer_summary,client_summary,display_metrics,generated_at,version,input_fingerprint",
          )
          .eq("client_id", input.client_id)
          .eq("period_start", input.period_start)
          .eq("period_end", input.period_end)
          .eq("prompt_version", PROMPT_VERSION)
          .maybeSingle()
        if (cacheError) {
          throw new HttpError(500, "summary_cache_lookup_failed")
        }
        if (cached?.input_fingerprint === inputFingerprint) {
          const { input_fingerprint: _fingerprint, ...data } = cached
          return Response.json({ data, cached: true })
        }
      }

      console.info("summary model request started", {
        request_id: requestId,
        input_stats: {
          workouts: completedWorkouts.length,
          exercises: exercises.length,
          sets: sets.length,
          model_input_chars: JSON.stringify(modelInput).length,
          request_strategy: JSON.stringify(modelInput).length > MAX_DIRECT_MODEL_INPUT_CHARS
            ? 'chunked'
            : 'direct',
        },
      })
      const generated = await requestYandexSummary(
        modelInput,
        trainingData.period.start,
        trainingData.period.end,
        { requestId },
      )
      const generatedClientSummary = { ...generated.summary.client, inputFingerprint }
      const displayMetrics = {
        ...trainingData.consistency,
        progress_facts: buildSummaryProgressFacts(trainingData.exercises),
      }

      const summaryStore = isClient || isConnectedTrainer ? serviceClient() : userClient
      const { data: saved, error: saveError } = await summaryStore
        .from("client_training_summaries")
        .upsert({
          trainer_id: trainerId,
          client_id: input.client_id,
          period_start: input.period_start,
          period_end: input.period_end,
          summary: trainerSummaryAsText(generated.summary.trainer),
          trainer_summary: generated.summary.trainer,
          client_summary: generatedClientSummary,
          display_metrics: displayMetrics,
          model_uri: generated.modelUri,
          prompt_version: PROMPT_VERSION,
          input_fingerprint: inputFingerprint,
          input_stats: {
            workouts: completedWorkouts.length,
            exercises: exercises.length,
            sets: sets.length,
            model_version: generated.modelVersion,
          },
          token_usage: generated.usage,
          generated_at: new Date().toISOString(),
        }, {
          onConflict: "client_id,period_start,period_end,prompt_version",
        })
        .select(
          "id,client_id,period_start,period_end,trainer_summary,client_summary,display_metrics,generated_at,version",
        )
        .single()
      if (saveError || !saved) {
        throw new HttpError(500, "summary_save_failed")
      }

      if (isClient) {
        const { data: visible, error: visibleError } = await summaryStore
          .from("client_published_training_summaries")
          .upsert({
            source_summary_id: saved.id,
            trainer_id: trainerId,
            client_id: input.client_id,
            period_start: input.period_start,
            period_end: input.period_end,
            summary: generatedClientSummary,
            display_metrics: displayMetrics,
            generated_at: saved.generated_at,
            published_at: new Date().toISOString(),
            published_by: null,
          }, { onConflict: "client_id,period_start,period_end" })
          .select(
            "id,source_summary_id,client_id,period_start,period_end,summary,display_metrics,generated_at,published_at",
          )
          .single()
        if (visibleError || !visible) {
          throw new HttpError(500, "summary_visibility_save_failed")
        }
        return Response.json({ data: visible, cached: false })
      }

      return Response.json({ data: saved, cached: false })
    } catch (error) {
      if (error instanceof HttpError) {
        console.warn("summarize-client-training request failed", {
          request_id: requestId,
          code: error.message,
          status: error.status,
        })
        return Response.json(
          { error: error.message },
          {
            status: error.status,
            headers: { "x-fit-error-code": error.message },
          },
        )
      }
      if (error instanceof SyntaxError) {
        return Response.json({ error: "invalid_json" }, { status: 400 })
      }
      console.error("summarize-client-training failed", error)
      return Response.json(
        { error: "internal_error" },
        { status: 500, headers: { "x-fit-error-code": "internal_error" } },
      )
    }
})

Deno.serve(handler)
