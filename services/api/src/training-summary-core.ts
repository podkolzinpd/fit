import { aiStudioUsage, reportAiStudioMetric } from "./ai-studio-usage-metrics.js"
import { PrivateSummaryDiagnostic } from './legacy-summary/private-diagnostic.js'
import { parseYandexJson } from "./legacy-summary/self-service.js"
import { buildSummaryConsistency } from "./legacy-summary/summary-consistency.js"
import {
  SUMMARY_CHUNK_JSON_SCHEMA,
  SUMMARY_CHUNK_SYSTEM_PROMPT,
  SUMMARY_JSON_SCHEMA,
  SUMMARY_SYSTEM_PROMPT,
} from "./legacy-summary/summary-contract.js"
import { MAX_SUMMARY_MODEL_INPUT_CHARS } from "./legacy-summary/summary-model-input.js"
import {
  assessSummaryQuality,
  repairSummaryQuality,
  summaryQualityIssueCodes,
  type SummaryQualityAssessment,
} from "./legacy-summary/summary-quality.js"
import type { YandexAiAuthorization } from "./yandex-ai-authorization.js"
import { invokeYandexLlmCompletion } from "./yandex-llm-function-client.js"


const YANDEX_COMPLETION_URL =
  "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
const MAX_PERIOD_DAYS = 366
export const MAX_SOURCE_ROWS = 10_000
const MAX_DIRECT_MODEL_INPUT_CHARS = 80_000
const inFlightSummaryRequests = new Map<string, Promise<YandexSummaryResult>>()

type SummarizeRequest = {
  client_id: string
  period_start: string
  period_end: string
  force: boolean
  trigger_reason: "create" | "new_workout" | "period_change" | "manual_refresh"
  diagnostic?: 'preflight' | 'run_once' | undefined
  diagnostic_fingerprint?: string | undefined
}

export type WorkoutRow = {
  id: string
  workout_date: string
  status: string
  deleted_at: string | null
  session_rpe: number | null
  wellbeing: string | null
  discomfort: boolean | null
  client_comment: string | null
}

export type ExerciseRow = {
  id: string
  workout_id: string
  exercise_ref: string
  exercise_name: string
  exercise_source?: string
  muscle_group?: string
  input_kind: string
  position: number
}

export type SetRow = {
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

export type ProgressRow = {
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

export type CustomMetricRow = { id: string; name: string; unit: string | null }
export type ProgressCustomRow = { progress_id: string; metric_id: string; value: number | string }

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

export type TrainerSummary = {
  headline: string
  progress: string[]
  consistency: string
  attention: string[]
}

export type ClientSummary = {
  headline: string
  achievements: string[]
  consistency: string
  encouragement: string
  goalAlignment: string
  nextSteps: string[]
  missingContext: string[]
  analysisVersion: string
}

export type GeneratedSummary = {
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

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly tokenUsage: Record<string, string> = {},
    readonly qualityIssueCodes: string[] = [],
  ) {
    super(message)
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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

export function trainerSummaryAsText(summary: TrainerSummary): string {
  const attention = summary.attention.length
    ? `\n\nНа что обратить внимание\n${summary.attention.map((item) => `- ${item}`).join("\n")}`
    : ""
  return [
    `Итог\n${summary.headline}`,
    `Прогресс\n${summary.progress.map((item) => `- ${item}`).join("\n")}`,
    `Регулярность\n${summary.consistency}${attention}`,
  ].join("\n\n")
}

export function parseRequest(value: unknown): SummarizeRequest {
  if (!value || typeof value !== "object") {
    throw new HttpError(400, "request_body_required")
  }

  const body = value as Record<string, unknown>
  const clientId = body.client_id
  const periodStart = body.period_start
  const periodEnd = body.period_end
  const force = body.force
  const triggerReason = body.trigger_reason
  if (body.diagnostic !== undefined && body.diagnostic !== 'preflight' && body.diagnostic !== 'run_once') {
    throw new HttpError(400, 'invalid_diagnostic')
  }
  if (body.diagnostic === 'run_once' && typeof body.diagnostic_fingerprint !== 'string') {
    throw new HttpError(400, 'diagnostic_preflight_required')
  }
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
  if (triggerReason !== undefined && triggerReason !== "create" && triggerReason !== "new_workout" &&
    triggerReason !== "period_change" && triggerReason !== "manual_refresh") {
    throw new HttpError(400, "invalid_trigger_reason")
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
    trigger_reason: triggerReason ?? "manual_refresh",
    diagnostic: body.diagnostic,
    diagnostic_fingerprint: typeof body.diagnostic_fingerprint === 'string' ? body.diagnostic_fingerprint : undefined,
  }
}

export function requiredSecret(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new HttpError(500, `${name.toLowerCase()}_not_configured`)
  }
  return value
}

export function configuredModelId(): string {
  return process.env.YANDEX_CLOUD_MODEL_ID ?? "yandexgpt"
}

export async function fingerprint(value: unknown): Promise<string> {
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
  planned_max_weight_kg?: number | undefined
  planned_total_reps?: number | undefined
  planned_volume_kg?: number | undefined
  max_weight_kg?: number | undefined
  total_reps?: number | undefined
  volume_kg?: number | undefined
  total_duration_min?: number | undefined
  total_distance_km?: number | undefined
  pace_min_per_km?: number | undefined
  average_rpe?: number | undefined
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

export function addUtcDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export function inclusivePeriodDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000) + 1
}

function setValues(set: SetRow, kind: 'plan' | 'fact'): Record<string, number> | null {
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

export function buildProgressData(
  workouts: readonly WorkoutRow[],
  exercises: readonly ExerciseRow[],
  sets: readonly SetRow[],
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
      muscle_group: exercise.muscle_group ?? 'other',
      source: exercise.exercise_source ?? 'unknown',
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
          planned: setValues(set, 'plan'),
          performed: set.confirmed_at === null ? null : setValues(set, 'fact'),
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
  diagnostic?: boolean
  authorization?: YandexAiAuthorization
  fetchImpl?: typeof fetch
  requestId?: string
  invocationId?: string
  iamToken?: string
  sleep?: (delayMs: number) => Promise<void>
  skipChunking?: boolean
  qualityData?: unknown
  stage?: 'direct' | 'chunk' | 'synthesis'
  chunkIndex?: number
  chunkTotal?: number
}

function modelInputChunks(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.exercises)) return [value]
  const previous = isRecord(value.previous_period) ? value.previous_period : null
  const units = [
    ...value.exercises.map((exercise: unknown) => ({ period: 'current', exercise })),
    ...(Array.isArray(previous?.exercises)
      ? previous.exercises.map((exercise: unknown) => ({ period: 'previous', exercise }))
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

function yandexResponseError(status: number): HttpError {
  if (status === 408 || status === 504) {
    return new HttpError(504, "yandex_cloud_timeout")
  }
  if (status === 429) {
    return new HttpError(503, "yandex_cloud_rate_limited")
  }
  if (status >= 500) {
    return new HttpError(502, "yandex_cloud_unavailable")
  }
  if (status === 401 || status === 403) {
    return new HttpError(502, "yandex_cloud_access_rejected")
  }
  return new HttpError(502, "yandex_cloud_request_rejected")
}

function isRetryableYandexStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function yandexRetryDelay(attempt: number): number {
  return attempt === 1 ? 600 : 1_800
}

type StructuredYandexConfig<T> = {
  systemPrompt: string
  schema: unknown
  maxTokens: string
  parse: (text: string) => T
  qualityAssessment?: (value: T) => SummaryQualityAssessment
  qualityRepair?: (value: T) => T
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
  const runtimeFetch = options.fetchImpl ?? fetch
  const mockedRuntimeFetch = (runtimeFetch as typeof fetch & { _isMockFunction?: boolean })._isMockFunction === true
  if (process.env.NODE_ENV === "test" && !options.fetchImpl && !mockedRuntimeFetch) {
    throw new Error("live_ai_disabled_in_tests")
  }
  const apiKey = options.authorization === undefined
    ? requiredSecret("YANDEX_CLOUD_API_KEY")
    : undefined
  const folderId = requiredSecret("YANDEX_CLOUD_FOLDER_ID")
  const modelId = configuredModelId()
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
  const fetchImpl = runtimeFetch
  const sleep = options.sleep ?? ((delayMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)))

  // A summary fingerprint is allowed to spend tokens once. Content/schema
  // repair is deterministic outside the model; a second paid call is never
  // hidden inside one browser action.
  const maxAttempts = 1
  let repairMessages: typeof messages | null = null
  let contentRepairAttempted = false
  const setTargetedRepair = (text: string, issues: string[]) => {
    contentRepairAttempted = true
    repairMessages = [
      {
        role: "system",
        text: "Исправь уже подготовленный анализ ФИТ. Сохрани подтверждённые факты и смысл, не добавляй новые данные. Верни только полный JSON по исходной схеме.",
      },
      {
        role: "user",
        text: JSON.stringify({ previous_answer: text, violations: issues }),
      },
    ]
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90_000)
    let response: Response
    try {
      const requestBody = {
        modelUri,
        completionOptions: { stream: false, temperature: attempt === 1 ? 0.2 : 0, maxTokens: config.maxTokens },
        jsonSchema: { schema: config.schema },
        messages: repairMessages ?? messages,
      }
      if (process.env.YANDEX_LLM_FUNCTION_URL && process.env.YANDEX_LLM_GATEWAY_PRIVATE_KEY) {
        const result = await invokeYandexLlmCompletion(requestBody, 90_000, fetchImpl)
        response = new Response(JSON.stringify(result.payload), { status: 200, headers: { 'x-request-id': result.requestId ?? '' } })
      } else {
        const authorization = options.authorization === undefined
          ? `Api-Key ${apiKey}`
          : await options.authorization.authorizationHeader()
        response = await fetchImpl(YANDEX_COMPLETION_URL, {
        method: "POST",
        headers: {
          "Authorization": authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        })
      }
    } catch (error) {
      const failure = error instanceof Error && error.name === "AbortError"
        ? new HttpError(504, "yandex_cloud_timeout")
        : new HttpError(502, "yandex_cloud_unavailable")
      if (attempt < maxAttempts) {
        structuredRetryLog(options, attempt, failure.message, null, 0, null)
        await sleep(yandexRetryDelay(attempt))
        continue
      }
      throw failure
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      await reportAiStudioMetric({
        functionName: "fit-summarize-client-training",
        modelUri,
        invocationId: options.invocationId ?? null,
        iamToken: options.iamToken ?? null,
        upstreamRequestId: response.headers.get("x-request-id"),
        usage: null,
      })
      const failure = yandexResponseError(response.status)
      if (attempt < maxAttempts && isRetryableYandexStatus(response.status)) {
        structuredRetryLog(options, attempt, failure.message, null, 0, null)
        await sleep(yandexRetryDelay(attempt))
        continue
      }
      throw failure
    }

    const payloadText = await response.text()
    let payload: YandexCompletionResponse
    try {
      payload = parseYandexJson<YandexCompletionResponse>(payloadText)
    } catch {
      await reportAiStudioMetric({
        functionName: "fit-summarize-client-training",
        modelUri,
        invocationId: options.invocationId ?? null,
        iamToken: options.iamToken ?? null,
        upstreamRequestId: response.headers.get("x-request-id"),
        usage: null,
      })
      const code = "yandex_cloud_invalid_upstream_json"
      if (attempt < maxAttempts) {
        structuredRetryLog(options, attempt, code, null, 0, null)
        await sleep(yandexRetryDelay(attempt))
        continue
      }
      throw new HttpError(502, code, usage)
    }
    const alternative = payload.result?.alternatives?.[0]
    const alternativeStatus = alternative?.status ?? null
    const text = alternative?.message?.text?.trim() ?? ""
    await reportAiStudioMetric({
      functionName: "fit-summarize-client-training",
      modelUri,
      invocationId: options.invocationId ?? null,
      iamToken: options.iamToken ?? null,
      upstreamRequestId: response.headers.get("x-request-id"),
      usage: aiStudioUsage(payload.result?.usage),
    })

    modelVersion = payload.result?.modelVersion ?? modelVersion
    for (const [key, value] of Object.entries(payload.result?.usage ?? {})) {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) {
        usage[key] = String(Number(usage[key] ?? 0) + numeric)
      }
    }
    const completionTokens = payload.result?.usage?.completionTokens ?? null
    if (options.diagnostic) {
      let issues: string[]
      try {
        const quality = config.qualityAssessment?.(config.parse(text))
        issues = [...(quality?.blockingIssues ?? []), ...(quality?.advisories ?? [])]
      } catch {
        issues = ['diagnostic_response_parse_failed']
      }
      throw new PrivateSummaryDiagnostic({ answer: text, issues, alternativeStatus, modelVersion, usage })
    }
    if (
      alternativeStatus === "ALTERNATIVE_STATUS_TRUNCATED_FINAL" ||
      alternativeStatus === "ALTERNATIVE_STATUS_PARTIAL"
    ) {
      const code = "yandex_cloud_truncated_response"
      if (attempt < maxAttempts && !contentRepairAttempted) {
        structuredRetryLog(options, attempt, code, alternativeStatus, text.length, completionTokens)
        contentRepairAttempted = true
        repairMessages = [
          ...messages,
          { role: "user", text: "Ответ оборвался. Верни более короткий полный JSON без Markdown и пояснений." },
        ]
        continue
      }
      throw new HttpError(502, code, usage)
    }
    if (alternativeStatus === "ALTERNATIVE_STATUS_CONTENT_FILTER") {
      throw new HttpError(502, "yandex_cloud_request_rejected", usage)
    }
    if (!text) {
      const code = "yandex_cloud_empty_response"
      if (attempt < maxAttempts && !contentRepairAttempted) {
        structuredRetryLog(options, attempt, code, alternativeStatus, 0, completionTokens)
        contentRepairAttempted = true
        repairMessages = messages
        continue
      }
      throw new HttpError(502, code, usage)
    }

    let value: T
    try {
      value = config.parse(text)
    } catch (error) {
      const code = error instanceof HttpError
        ? error.message
        : "yandex_cloud_invalid_summary"
      if (attempt < maxAttempts && !contentRepairAttempted) {
        structuredRetryLog(options, attempt, code, alternativeStatus, text.length, completionTokens)
        setTargetedRepair(text, ["Ответ нельзя разобрать как полный JSON по схеме."])
        continue
      }
      throw new HttpError(502, code, usage)
    }
    let quality = config.qualityAssessment?.(value) ?? { blockingIssues: [], advisories: [] }
    let issues = quality.blockingIssues
    if (issues.length > 0 && config.qualityRepair && config.qualityAssessment) {
      const repairedValue = config.qualityRepair(value)
      const repairedQuality = config.qualityAssessment(repairedValue)
      console.info("summary deterministic quality repair", {
        request_id: options.requestId ?? null,
        stage: options.stage ?? 'direct',
        repaired_issue_codes: summaryQualityIssueCodes(issues),
        remaining_issue_codes: summaryQualityIssueCodes(repairedQuality.blockingIssues),
      })
      value = repairedValue
      quality = repairedQuality
      issues = repairedQuality.blockingIssues
    }
    if (issues.length === 0 && (quality.advisories.length === 0 || contentRepairAttempted || attempt === maxAttempts)) {
      return { value, modelUri, modelVersion, usage }
    }
    if (issues.length === 0) {
      console.warn("summary style check requested one repair", {
        request_id: options.requestId ?? null,
        stage: options.stage ?? 'direct',
        chunk_index: options.chunkIndex ?? null,
        chunk_total: options.chunkTotal ?? null,
        attempt,
        issue_count: quality.advisories.length,
        issues: quality.advisories,
      })
      setTargetedRepair(text, quality.advisories)
      continue
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
    if (attempt === maxAttempts || contentRepairAttempted) {
      throw new HttpError(
        502,
        "yandex_cloud_quality_check_failed",
        usage,
        summaryQualityIssueCodes(issues),
      )
    }
    setTargetedRepair(text, issues)
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
    maxTokens: "1000",
    parse: parseGeneratedSummary,
    qualityAssessment: (summary) => assessSummaryQuality(summary, options.qualityData ?? trainingData),
    qualityRepair: (summary) => repairSummaryQuality(summary, options.qualityData ?? trainingData),
  }, options)
  return {
    summary: result.value,
    modelUri: result.modelUri,
    modelVersion: result.modelVersion,
    usage: result.usage,
  }
}

export async function requestYandexSummary(
  trainingData: unknown,
  periodStart: string,
  periodEnd: string,
  options: YandexRequestOptions = {},
): Promise<YandexSummaryResult> {
  if (process.env.FIT_AI_SUMMARY_GENERATION_DISABLED === "true") {
    throw new HttpError(503, "summary_generation_disabled")
  }
  const serializedInputChars = JSON.stringify(trainingData).length
  if (options.diagnostic && JSON.stringify(trainingData).length > MAX_DIRECT_MODEL_INPUT_CHARS) {
    throw new HttpError(422, 'diagnostic_direct_only')
  }
  if (!options.diagnostic && serializedInputChars > MAX_SUMMARY_MODEL_INPUT_CHARS) {
    throw new HttpError(422, 'summary_model_input_too_large')
  }
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

export async function requestYandexSummaryDeduplicated(
  key: string,
  trainingData: unknown,
  periodStart: string,
  periodEnd: string,
  options: YandexRequestOptions,
): Promise<{ result: YandexSummaryResult; shared: boolean }> {
  const existing = inFlightSummaryRequests.get(key)
  if (existing) return { result: await existing, shared: true }

  const pending = requestYandexSummary(trainingData, periodStart, periodEnd, options)
  inFlightSummaryRequests.set(key, pending)
  try {
    return { result: await pending, shared: false }
  } finally {
    if (inFlightSummaryRequests.get(key) === pending) inFlightSummaryRequests.delete(key)
  }
}
