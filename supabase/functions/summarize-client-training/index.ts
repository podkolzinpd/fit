import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2.110.8"
import { withSupabase } from "@supabase/server"
import {
  PROMPT_VERSION,
  SUMMARY_JSON_SCHEMA,
  SUMMARY_SYSTEM_PROMPT,
} from "./summary-contract.ts"
import { summaryQualityIssues } from "./summary-quality.ts"
import { buildTrainingGoalContext } from "./summary-goal.ts"
import {
  authorizeSummaryActor,
  parseYandexJson,
  shouldUseClientCache,
  yandexHttpError,
} from "./self-service.ts"
import { completedWorkoutsInPeriod } from "./workout-source.ts"
import { buildSummaryConsistency } from "./summary-consistency.ts"
import { buildSummaryProgressFacts } from "./summary-progress-facts.ts"

const YANDEX_COMPLETION_URL =
  "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
const MAX_PERIOD_DAYS = 366
const MAX_SOURCE_ROWS = 1000

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
}

type ExerciseRow = {
  id: string
  workout_id: string
  exercise_ref: string
  exercise_name: string
  input_kind: string
  position: number
}

type SetRow = {
  workout_exercise_id: string
  position: number
  fact_weight_kg: number | null
  fact_reps: number | null
  fact_duration_min: number | null
  fact_duration_sec: number | null
  fact_distance_km: number | null
}

type YandexCompletionResponse = {
  result?: {
    alternatives?: Array<{
      message?: {
        text?: string
      }
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
}

type GeneratedSummary = {
  trainer: TrainerSummary
  client: ClientSummary
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
    throw new HttpError(502, "yandex_cloud_invalid_json")
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
    },
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
  return createClient(
    requiredSecret("SUPABASE_URL"),
    requiredSecret("SUPABASE_PUBLISHABLE_KEY"),
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
  max_weight_kg?: number
  total_reps?: number
  volume_kg?: number
  total_duration_min?: number
  total_distance_km?: number
  pace_min_per_km?: number
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}

function percentChange(start?: number, end?: number): number | undefined {
  if (start === undefined || end === undefined || start <= 0) return undefined
  return Math.round(((end - start) / start) * 100)
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
    name: string
    kind: string
    sessions: Map<string, SessionMetrics>
  }>()

  for (const exercise of exercises) {
    const date = workoutDateById.get(exercise.workout_id)
    if (!date) continue

    const exerciseSets = setsByExercise.get(exercise.id) ?? []
    const weights = exerciseSets.flatMap((set) =>
      set.fact_weight_kg === null ? [] : [Number(set.fact_weight_kg)]
    )
    const reps = exerciseSets.flatMap((set) =>
      set.fact_reps === null ? [] : [Number(set.fact_reps)]
    )
    const durations = exerciseSets.flatMap((set) => {
      if (set.fact_duration_sec !== null) return [Number(set.fact_duration_sec) / 60]
      return set.fact_duration_min === null ? [] : [Number(set.fact_duration_min)]
    })
    const distances = exerciseSets.flatMap((set) =>
      set.fact_distance_km === null ? [] : [Number(set.fact_distance_km)]
    )
    const volume = exerciseSets.reduce(
      (sum, set) =>
        sum + (
          set.fact_weight_kg === null || set.fact_reps === null
            ? 0
            : Number(set.fact_weight_kg) * Number(set.fact_reps)
        ),
      0,
    )

    const progress = exerciseProgress.get(exercise.exercise_ref) ?? {
      name: exercise.exercise_name,
      kind: exercise.input_kind,
      sessions: new Map<string, SessionMetrics>(),
    }
    const existing = progress.sessions.get(date)
    const session: SessionMetrics = {
      date,
      set_count: (existing?.set_count ?? 0) + exerciseSets.length,
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
    }
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
    exercises: Array.from(exerciseProgress.values())
      .map((progress) => {
        const sessions = Array.from(progress.sessions.values())
          .sort((left, right) => left.date.localeCompare(right.date))
        const first = sessions[0]
        const last = sessions.at(-1)
        return {
          name: progress.name,
          kind: progress.kind,
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

async function requestYandexSummary(
  trainingData: unknown,
  periodStart: string,
  periodEnd: string,
) {
  const apiKey = requiredSecret("YANDEX_CLOUD_API_KEY")
  const folderId = requiredSecret("YANDEX_CLOUD_FOLDER_ID")
  const modelId = Deno.env.get("YANDEX_CLOUD_MODEL_ID") ?? "yandexgpt"
  const modelUri = `gpt://${folderId}/${modelId}/latest`

  const messages = [
    { role: "system", text: SUMMARY_SYSTEM_PROMPT },
    {
      role: "user",
      text: JSON.stringify({
        period: { start: periodStart, end: periodEnd },
        completed_workouts: trainingData,
      }),
    },
  ]
  let usage: Record<string, string> = {}
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
            temperature: 0.1,
            maxTokens: "1800",
          },
          jsonSchema: { schema: SUMMARY_JSON_SCHEMA },
          messages,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new HttpError(504, "yandex_cloud_timeout")
      }
      throw new HttpError(502, "yandex_cloud_unavailable")
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      throw new HttpError(502, yandexHttpError(response.status, await response.text()))
    }

    const payloadText = await response.text()
    let payload: YandexCompletionResponse
    try {
      payload = parseYandexJson<YandexCompletionResponse>(payloadText)
    } catch {
      throw new HttpError(502, "yandex_cloud_invalid_json")
    }
    const text = payload.result?.alternatives?.[0]?.message?.text?.trim()
    if (!text) throw new HttpError(502, "yandex_cloud_empty_response")

    modelVersion = payload.result?.modelVersion ?? modelVersion
    for (const [key, value] of Object.entries(payload.result?.usage ?? {})) {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) {
        usage[key] = String(Number(usage[key] ?? 0) + numeric)
      }
    }

    const summary = parseGeneratedSummary(text)
    const issues = summaryQualityIssues(summary, trainingData)
    if (issues.length === 0) {
      return { summary, modelUri, modelVersion, usage }
    }
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

const handler = withSupabase({ auth: "none" }, async (req, _ctx) => {
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
        authorizationPresent: Boolean(req.headers.get("authorization")),
        actorIdPresent: Boolean(actorId),
        authError: authError?.message ?? null,
        clientId: input.client_id,
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

      if (isClient && !input.force) {
        const { data: cached, error: cacheError } = await userClient
          .from("client_published_training_summaries")
          .select(
            "id,source_summary_id,client_id,period_start,period_end,summary,display_metrics,generated_at,published_at",
          )
          .eq("client_id", input.client_id)
          .eq("period_start", input.period_start)
          .eq("period_end", input.period_end)
          .maybeSingle()
        if (cacheError) throw new HttpError(500, "summary_cache_lookup_failed")
        if (shouldUseClientCache(input.force, cached)) {
          return Response.json({ data: cached, cached: true })
        }
      }

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

      const { data: workouts, error: workoutsError } = await userClient
        .from("workouts")
        .select("id,workout_date,status,deleted_at")
        .eq("client_id", input.client_id)
        .eq("trainer_id", trainerId)
        .eq("status", "done")
        .is("deleted_at", null)
        .gte("workout_date", input.period_start)
        .lte("workout_date", input.period_end)
        .order("workout_date")
        .limit(MAX_SOURCE_ROWS)
      if (workoutsError) {
        throw new HttpError(500, "workouts_lookup_failed")
      }
      const completedWorkouts = completedWorkoutsInPeriod(
        workouts,
        input.period_start,
        input.period_end,
      )
      if (completedWorkouts.length === 0) {
        throw new HttpError(422, "no_completed_workouts")
      }
      if (workouts.length === MAX_SOURCE_ROWS) {
        throw new HttpError(422, "source_row_limit_reached")
      }

      const workoutIds = completedWorkouts.map((workout) => workout.id)
        const { data: exercises, error: exercisesError } = await userClient
        .from("workout_exercises")
        .select("id,workout_id,exercise_ref,exercise_name,input_kind,position")
        .in("workout_id", workoutIds)
        .order("position")
        .limit(MAX_SOURCE_ROWS)
      if (exercisesError) {
        throw new HttpError(500, "exercises_lookup_failed")
      }
      if (exercises.length === MAX_SOURCE_ROWS) {
        throw new HttpError(422, "source_row_limit_reached")
      }

      const exerciseIds = exercises.map((exercise) => exercise.id)
      let sets: SetRow[] = []
      if (exerciseIds.length > 0) {
        const { data, error } = await userClient
          .from("workout_sets")
          .select(
            "workout_exercise_id,position,fact_weight_kg,fact_reps,fact_duration_min,fact_duration_sec,fact_distance_km",
          )
          .in("workout_exercise_id", exerciseIds)
          .not("confirmed_at", "is", null)
          .order("position")
          .limit(MAX_SOURCE_ROWS)
        if (error) {
          throw new HttpError(500, "sets_lookup_failed")
        }
        if (data.length === MAX_SOURCE_ROWS) {
          throw new HttpError(422, "source_row_limit_reached")
        }
        sets = data
      }

      const trainingData = {
        ...buildProgressData(
          completedWorkouts,
          exercises,
          sets,
          input.period_start,
          input.period_end,
          firstCompletedWorkout?.workout_date ?? null,
        ),
        goal: goalContext,
      }
      const inputFingerprint = await fingerprint(trainingData)

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

      const generated = await requestYandexSummary(
        trainingData,
        trainingData.period.start,
        trainingData.period.end,
      )
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
          client_summary: generated.summary.client,
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
            summary: generated.summary.client,
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
        return Response.json({ error: error.message }, { status: error.status })
      }
      if (error instanceof SyntaxError) {
        return Response.json({ error: "invalid_json" }, { status: 400 })
      }
      console.error("summarize-client-training failed", error)
      return Response.json({ error: "internal_error" }, { status: 500 })
    }
})

Deno.serve(handler)
