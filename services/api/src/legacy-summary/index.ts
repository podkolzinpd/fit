/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-vars -- Supabase REST row shapes are runtime-validated by the existing Edge contract and will be replaced with typed Yandex DTOs after data cutover. */
import { createClient } from "@supabase/supabase-js"
import {
  addUtcDays,
  buildProgressData,
  configuredModelId,
  fingerprint,
  HttpError,
  inclusivePeriodDays,
  isRecord,
  MAX_SOURCE_ROWS,
  parseRequest,
  requestYandexSummary,
  requestYandexSummaryDeduplicated,
  requiredSecret,
  trainerSummaryAsText,
  type CustomMetricRow,
  type ProgressCustomRow,
  type ProgressRow,
  type SetRow,
} from '../training-summary-core.js'
import type { YandexAiAuthorization } from "../yandex-ai-authorization.js"
import { diagnosticAllowed, PrivateSummaryDiagnostic } from './private-diagnostic.js'
import { authorizeSummaryActor } from "./self-service.js"
import { PROMPT_VERSION, SUMMARY_ANALYSIS_VERSION } from "./summary-contract.js"
import { buildTrainingGoalContext } from "./summary-goal.js"
import {
  buildSummaryFingerprintPayload,
  buildSummaryModelInput,
  MAX_SUMMARY_MODEL_INPUT_CHARS,
  SUMMARY_AGGREGATOR_VERSION,
} from "./summary-model-input.js"
import { buildSummaryProgressFacts } from "./summary-progress-facts.js"
import { resolveSupabasePublicKey } from "./supabase-public-key.js"
import { completedWorkoutsInPeriod } from "./workout-source.js"
export {
  buildProgressData,
  configuredModelId,
  HttpError,
  requestYandexSummary,
  requestYandexSummaryDeduplicated,
  trainerSummaryAsText,
  type ClientSummary,
  type ExerciseRow,
  type GeneratedSummary,
  type SetRow,
  type TrainerSummary,
  type WorkoutRow,
} from '../training-summary-core.js'


function serviceClient() {
  return createClient(
    requiredSecret("SUPABASE_URL"),
    requiredSecret("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
}

function throwSupabaseOperationError(
  requestId: string,
  operation: string,
  error: unknown,
  status: number,
  publicCode: string,
): never {
  const details = isRecord(error) ? error : {}
  console.warn('summary supabase operation failed', {
    request_id: requestId,
    operation,
    upstream_code: typeof details.code === 'string' ? details.code.slice(0, 80) : null,
    upstream_message: typeof details.message === 'string' ? details.message.slice(0, 240) : null,
  })
  throw new HttpError(status, publicCode)
}

type GenerationDecision = 'claimed' | 'cached' | 'in_progress' | 'cooldown' | 'period_limit' | 'daily_limit'

function parseGenerationDecision(value: unknown): GenerationDecision {
  if (!isRecord(value)) throw new HttpError(503, 'summary_generation_guard_failed')
  const decision = value.decision
  if (decision === 'claimed' || decision === 'cached' || decision === 'in_progress'
    || decision === 'cooldown' || decision === 'period_limit' || decision === 'daily_limit') return decision
  throw new HttpError(503, 'summary_generation_guard_failed')
}

function requestClient(req: Request) {
  const authorization = req.headers.get("authorization")
  const publicKey = resolveSupabasePublicKey({
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? null,
    publishableKeys: process.env.SUPABASE_PUBLISHABLE_KEYS ?? null,
    anonKey: process.env.SUPABASE_ANON_KEY ?? null,
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

type SummarizeClientTrainingOptions = {
  authorization?: YandexAiAuthorization
}

export const summarizeClientTraining = async (
  req: Request,
  options: SummarizeClientTrainingOptions = {},
): Promise<Response> => {
    const suppliedRequestId = req.headers.get('x-fit-request-id')
    const requestId = suppliedRequestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedRequestId)
      ? suppliedRequestId
      : crypto.randomUUID()
    const invocationId = req.headers.get("x-yc-request-id")
    const iamToken = req.headers.get("x-yc-iam-token")
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
      if (!client) {
        throw new HttpError(404, "client_not_found")
      }
      const { isTrainer, isClient, isConnectedTrainer, trainerId } = actor
      if (input.diagnostic && (!user || !diagnosticAllowed(user, isClient))) {
        throw new HttpError(403, 'diagnostic_not_allowed')
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
        customMetrics = metrics
        customValues = values
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
      const modelInput = buildSummaryModelInput(trainingData)
      const sourceInputChars = JSON.stringify(trainingData).length
      const modelInputChars = JSON.stringify(modelInput).length
      const inputFingerprint = await fingerprint(buildSummaryFingerprintPayload({
        promptVersion: PROMPT_VERSION,
        analysisVersion: SUMMARY_ANALYSIS_VERSION,
        modelId: configuredModelId(),
        modelInput,
      }))

      if (input.diagnostic) {
        const stats = { workouts: completedWorkouts.length, exercises: exercises.length, sets: sets.length, source_input_chars: sourceInputChars, model_input_chars: modelInputChars }
        const headers = { 'Cache-Control': 'no-store' }
        if (input.diagnostic === 'preflight') {
          return Response.json({ diagnostic: true, calls: 0, stats, fingerprint: inputFingerprint }, { headers })
        }
        if (input.diagnostic_fingerprint !== inputFingerprint) {
          throw new HttpError(409, 'diagnostic_input_changed')
        }
        try {
          await requestYandexSummary(modelInput, trainingData.period.start, trainingData.period.end, {
            requestId,
            diagnostic: true,
            ...(options.authorization === undefined ? {} : { authorization: options.authorization }),
          })
        } catch (error) {
          if (error instanceof PrivateSummaryDiagnostic) {
            return Response.json({ diagnostic: true, calls: 1, stats, fingerprint: inputFingerprint, ...error.result }, { headers })
          }
          throw error
        }
        // Fail closed even if a future model adapter accidentally returns normally.
        throw new HttpError(500, 'diagnostic_result_missing')
      }

      if (isClient) {
        const { data: cached, error: cacheError } = await userClient
          .from("client_published_training_summaries")
          .select("id,source_summary_id,client_id,period_start,period_end,summary,display_metrics,generated_at,published_at")
          .eq("client_id", input.client_id)
          .eq("period_start", input.period_start)
          .eq("period_end", input.period_end)
          .maybeSingle()
        if (cacheError) throwSupabaseOperationError(
          requestId, 'read_client_published_cache', cacheError, 500, 'summary_cache_lookup_failed',
        )
        const cachedSummary = cached?.summary && typeof cached.summary === 'object' && !Array.isArray(cached.summary)
          ? cached.summary as Record<string, unknown>
          : null
        if (cached && cachedSummary?.analysisVersion === SUMMARY_ANALYSIS_VERSION && cachedSummary.inputFingerprint === inputFingerprint) {
          console.info("summary cache hit", { request_id: requestId, actor: "client", force_requested: input.force, trigger_reason: input.trigger_reason })
          return Response.json({ data: cached, cached: true })
        }
        const { data: sharedCache, error: sharedCacheError } = await serviceClient().rpc(
          "publish_cached_training_summary_for_client",
          {
            p_client_id: input.client_id,
            p_period_start: input.period_start,
            p_period_end: input.period_end,
            p_prompt_version: PROMPT_VERSION,
            p_input_fingerprint: inputFingerprint,
          },
        )
        if (sharedCacheError) throwSupabaseOperationError(
          requestId, 'publish_client_shared_cache', sharedCacheError, 500, 'summary_cache_lookup_failed',
        )
        if (sharedCache) {
          console.info("summary shared cache published", { request_id: requestId, trigger_reason: input.trigger_reason })
          return Response.json({ data: sharedCache, cached: true })
        }
      }

      if (isTrainer) {
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
          throwSupabaseOperationError(
            requestId, 'read_trainer_cache', cacheError, 500, 'summary_cache_lookup_failed',
          )
        }
        if (cached?.input_fingerprint === inputFingerprint) {
          console.info("summary cache hit", { request_id: requestId, actor: "trainer", force_requested: input.force, trigger_reason: input.trigger_reason })
          const { input_fingerprint: _fingerprint, ...data } = cached
          return Response.json({ data, cached: true })
        }
      }

      if (modelInputChars > MAX_SUMMARY_MODEL_INPUT_CHARS) {
        throw new HttpError(422, 'summary_model_input_too_large')
      }
      if (process.env.FIT_AI_SUMMARY_GENERATION_DISABLED === 'true') {
        throw new HttpError(503, 'summary_generation_disabled')
      }

      const summaryStore = isClient || isConnectedTrainer ? serviceClient() : userClient
      const generationGuardStore = serviceClient()
      const { data: claimData, error: claimError } = await generationGuardStore.rpc(
        'claim_training_summary_generation',
        {
          p_client_id: input.client_id,
          p_period_start: input.period_start,
          p_period_end: input.period_end,
          p_input_fingerprint: inputFingerprint,
          p_request_id: requestId,
          p_source_input_chars: sourceInputChars,
          p_model_input_chars: modelInputChars,
        },
      )
      if (claimError) throwSupabaseOperationError(
        requestId, 'claim_generation_guard', claimError, 503, 'summary_generation_guard_failed',
      )
      const generationDecision = parseGenerationDecision(claimData)
      console.info('summary generation guard decision', {
        request_id: requestId,
        decision: generationDecision,
        fingerprint_prefix: inputFingerprint.slice(0, 12),
        force_requested: input.force,
        trigger_reason: input.trigger_reason,
        source_input_chars: sourceInputChars,
        model_input_chars: modelInputChars,
      })
      if (generationDecision === 'cached') {
        if (isClient) {
          const { data: sharedCache, error: sharedCacheError } = await generationGuardStore.rpc(
            'publish_cached_training_summary_for_client',
            {
              p_client_id: input.client_id,
              p_period_start: input.period_start,
              p_period_end: input.period_end,
              p_prompt_version: PROMPT_VERSION,
              p_input_fingerprint: inputFingerprint,
            },
          )
          if (sharedCacheError) throwSupabaseOperationError(
            requestId, 'publish_guarded_client_cache', sharedCacheError, 500, 'summary_cache_lookup_failed',
          )
          if (sharedCache) return Response.json({ data: sharedCache, cached: true })
        }
        if (isTrainer) {
          const { data: cached, error: cacheError } = await userClient
            .from('client_training_summaries')
            .select('id,client_id,period_start,period_end,trainer_summary,client_summary,display_metrics,generated_at,version,input_fingerprint')
            .eq('client_id', input.client_id)
            .eq('period_start', input.period_start)
            .eq('period_end', input.period_end)
            .eq('prompt_version', PROMPT_VERSION)
            .maybeSingle()
          if (cacheError) throwSupabaseOperationError(
            requestId, 'read_guarded_trainer_cache', cacheError, 500, 'summary_cache_lookup_failed',
          )
          if (cached?.input_fingerprint === inputFingerprint) {
            const { input_fingerprint: _fingerprint, ...data } = cached
            return Response.json({ data, cached: true })
          }
        }
        throw new HttpError(409, 'summary_generation_in_progress')
      }
      if (generationDecision === 'in_progress') {
        throw new HttpError(409, 'summary_generation_in_progress')
      }
      if (generationDecision === 'cooldown') {
        throw new HttpError(429, 'summary_generation_cooldown')
      }
      if (generationDecision === 'period_limit') {
        throw new HttpError(429, 'summary_generation_period_limit')
      }
      if (generationDecision === 'daily_limit') {
        throw new HttpError(429, 'summary_generation_daily_limit')
      }

      const recordGenerationFailure = async (error: unknown, fallbackUsage: Record<string, string> = {}) => {
        const code = error instanceof Error ? error.message : 'summary_generation_failed'
        const usage = error instanceof HttpError ? error.tokenUsage : fallbackUsage
        const qualityIssueCodes = error instanceof HttpError ? error.qualityIssueCodes : []
        const storedCode = qualityIssueCodes.length > 0
          ? `${code}:${qualityIssueCodes.join(',')}`.slice(0, 120)
          : code
        const { error: guardError } = await generationGuardStore.rpc(
          'fail_training_summary_generation',
          {
            p_client_id: input.client_id,
            p_period_start: input.period_start,
            p_period_end: input.period_end,
            p_input_fingerprint: inputFingerprint,
            p_request_id: requestId,
            p_failure_code: storedCode,
            p_token_usage: usage,
          },
        )
        console.warn('summary generation failed', {
          request_id: requestId,
          code,
          quality_issue_codes: qualityIssueCodes,
        })
        if (guardError) console.error('summary generation failure record failed', { request_id: requestId })
      }

      console.info("summary model request started", {
        request_id: requestId,
        input_stats: {
          workouts: completedWorkouts.length,
          exercises: exercises.length,
          sets: sets.length,
          source_input_chars: sourceInputChars,
          model_input_chars: modelInputChars,
          aggregation_version: SUMMARY_AGGREGATOR_VERSION,
          fingerprint_prefix: inputFingerprint.slice(0, 12),
          force_requested: input.force,
          trigger_reason: input.trigger_reason,
          request_strategy: 'direct',
          model_calls: 1,
        },
      })
      const generationKey = `${input.client_id}:${input.period_start}:${input.period_end}:${inputFingerprint}`
      let generation: Awaited<ReturnType<typeof requestYandexSummaryDeduplicated>>
      try {
        generation = await requestYandexSummaryDeduplicated(
          generationKey,
          modelInput,
          trainingData.period.start,
          trainingData.period.end,
          {
            requestId,
            ...(invocationId === null ? {} : { invocationId }),
            ...(iamToken === null ? {} : { iamToken }),
            ...(options.authorization === undefined ? {} : { authorization: options.authorization }),
          },
        )
      } catch (error) {
        await recordGenerationFailure(error)
        throw error
      }
      const generated = generation.result
      console.info("summary model request completed", {
        request_id: requestId,
        shared_in_flight: generation.shared,
        fingerprint_prefix: inputFingerprint.slice(0, 12),
        model_input_chars: modelInputChars,
        total_tokens: generated.usage.totalTokens ?? null,
        input_tokens: generated.usage.inputTextTokens ?? null,
        output_tokens: generated.usage.completionTokens ?? null,
      })
      const generatedClientSummary = {
        ...generated.summary.client,
        analysisVersion: SUMMARY_ANALYSIS_VERSION,
        inputFingerprint,
      }
      const displayMetrics = {
        ...trainingData.consistency,
        progress_facts: buildSummaryProgressFacts(trainingData.exercises),
      }

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
        await recordGenerationFailure(new HttpError(500, 'summary_save_failed'), generated.usage)
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
          await recordGenerationFailure(new HttpError(500, 'summary_visibility_save_failed'), generated.usage)
          throw new HttpError(500, "summary_visibility_save_failed")
        }
        const { error: completeError } = await generationGuardStore.rpc(
          'complete_training_summary_generation',
          {
            p_client_id: input.client_id,
            p_period_start: input.period_start,
            p_period_end: input.period_end,
            p_input_fingerprint: inputFingerprint,
            p_request_id: requestId,
            p_token_usage: generated.usage,
          },
        )
        if (completeError) console.error('summary generation completion record failed', { request_id: requestId })
        return Response.json({ data: visible, cached: false })
      }

      const { error: completeError } = await generationGuardStore.rpc(
        'complete_training_summary_generation',
        {
          p_client_id: input.client_id,
          p_period_start: input.period_start,
          p_period_end: input.period_end,
          p_input_fingerprint: inputFingerprint,
          p_request_id: requestId,
          p_token_usage: generated.usage,
        },
      )
      if (completeError) console.error('summary generation completion record failed', { request_id: requestId })
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
}
