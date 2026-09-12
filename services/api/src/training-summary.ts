import { createHash, randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'

import type { DatabaseClient, DatabasePool } from './db/types.js'
import {
  buildProgressData,
  configuredModelId,
  HttpError,
  requestYandexSummary,
  trainerSummaryAsText,
  type ExerciseRow,
  type SetRow,
  type WorkoutRow,
} from './legacy-summary/index.js'
import { buildTrainingGoalContext } from './legacy-summary/summary-goal.js'
import {
  buildSummaryModelInput,
  MAX_SUMMARY_MODEL_INPUT_CHARS,
  SUMMARY_AGGREGATOR_VERSION,
} from './legacy-summary/summary-model-input.js'
import { buildSummaryProgressFacts } from './legacy-summary/summary-progress-facts.js'
import { PROMPT_VERSION, SUMMARY_ANALYSIS_VERSION } from './legacy-summary/summary-contract.js'
import type { YandexAiAuthorization } from './yandex-ai-authorization.js'
import {
  withYandexActorSession,
  type YandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'

const MAX_SOURCE_ROWS = 10_000

interface ClientRow extends QueryResultRow {
  auth_user_id: string | null
  goal: string | null
  trainer_id: string
}
interface GoalRow extends QueryResultRow {
  goal: unknown
}
interface FirstWorkoutRow extends QueryResultRow { workout_date: string }
interface ProgressRow extends QueryResultRow {
  recorded_on: string
  weight_kg: number | string | null
  chest_cm: number | string | null
  waist_cm: number | string | null
  hip_cm: number | string | null
}
interface SummaryRow extends QueryResultRow {
  input_fingerprint: string
  result: unknown
}
interface JsonRow extends QueryResultRow { result: unknown }
interface GuardRow extends QueryResultRow { result: unknown }

type GenerationDecision = 'claimed' | 'cached' | 'in_progress' | 'cooldown' | 'period_limit' | 'daily_limit'

function generationDecision(value: unknown): GenerationDecision {
  if (typeof value !== 'object' || value === null || !('decision' in value)) {
    throw new PilotTrainingSummaryError(503, 'summary_generation_guard_failed')
  }
  const decision = (value as { decision?: unknown }).decision
  if (decision === 'claimed' || decision === 'cached' || decision === 'in_progress'
    || decision === 'cooldown' || decision === 'period_limit' || decision === 'daily_limit') return decision
  throw new PilotTrainingSummaryError(503, 'summary_generation_guard_failed')
}

export class PilotTrainingSummaryError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

export interface TrainingSummaryRequest {
  clientId: string
  periodStart: string
  periodEnd: string
  force: boolean
}

export interface PilotTrainingSummaryReader {
  list(session: YandexActorSessionInput, clientId: string): Promise<unknown[]>
}

export interface PilotTrainingSummaryGenerator {
  generate(session: YandexActorSessionInput, request: TrainingSummaryRequest): Promise<unknown>
}

export interface PilotTrainingSummaryPublisher {
  publish(
    session: YandexActorSession,
    summaryId: string,
    clientSummary: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<void>
  unpublish?(
    session: YandexActorSession,
    summaryId: string,
    expectedVersion: number,
  ): Promise<void>
}

export interface PilotTrainingSummaries
  extends PilotTrainingSummaryReader, PilotTrainingSummaryGenerator {}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function asNumber(value: unknown): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function addUtcDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function inclusivePeriodDays(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) /
      86_400_000,
  ) + 1
}

export class DatabasePilotTrainingSummaries implements PilotTrainingSummaries {
  constructor(
    private readonly pool: DatabasePool,
    private readonly authorization?: YandexAiAuthorization,
  ) {}

  async list(session: YandexActorSessionInput, clientId: string): Promise<unknown[]> {
    return withYandexActorSession(this.pool, session, async (client) => {
      const actor = await this.readActor(client, clientId)
      const rows = actor === 'client'
        ? await client.query<JsonRow>(`
            select jsonb_build_object(
              'id', summary.id, 'source_summary_id', summary.source_summary_id,
              'client_id', summary.client_id, 'period_start', summary.period_start,
              'period_end', summary.period_end, 'summary', summary.summary,
              'display_metrics', summary.display_metrics,
              'generated_at', summary.generated_at, 'published_at', summary.published_at
            ) result
            from public.client_published_training_summaries summary
            where summary.client_id = $1
            order by summary.period_end desc, summary.published_at desc
          `, [clientId])
        : await client.query<JsonRow>(`
            select jsonb_build_object(
              'id', summary.id, 'client_id', summary.client_id,
              'period_start', summary.period_start, 'period_end', summary.period_end,
              'trainer_summary', summary.trainer_summary,
              'client_summary', summary.client_summary,
              'display_metrics', summary.display_metrics,
              'generated_at', summary.generated_at, 'version', summary.version,
              'published', exists (
                select 1 from public.client_published_training_summaries published
                where published.source_summary_id = summary.id
              )
            ) result
            from public.client_training_summaries summary
            where summary.client_id = $1
            order by summary.period_end desc, summary.generated_at desc
          `, [clientId])
      return rows.map((row) => row.result)
    })
  }

  async generate(session: YandexActorSessionInput, request: TrainingSummaryRequest): Promise<unknown> {
    const source = await withYandexActorSession(
      this.pool,
      session,
      (client) => this.readSource(client, request),
    )
    const modelInput = buildSummaryModelInput(source.trainingData)
    const sourceInputChars = JSON.stringify(source.trainingData).length
    const modelInputChars = JSON.stringify(modelInput).length
    if (modelInputChars > MAX_SUMMARY_MODEL_INPUT_CHARS) {
      throw new HttpError(422, 'summary_model_input_too_large')
    }
    const inputFingerprint = fingerprint({
      prompt_version: PROMPT_VERSION,
      analysis_version: SUMMARY_ANALYSIS_VERSION,
      aggregation_version: SUMMARY_AGGREGATOR_VERSION,
      model_id: configuredModelId(),
      source: source.trainingData,
    })
    const cached = await withYandexActorSession(
      this.pool,
      session,
      (client) => this.readCache(client, request, source.actor, inputFingerprint),
    )
    if (cached !== undefined) {
      console.info('summary cache hit', {
        fingerprint_prefix: inputFingerprint.slice(0, 12),
        force_requested: request.force,
      })
      return { data: cached, cached: true }
    }
    if (process.env.FIT_AI_SUMMARY_GENERATION_DISABLED === 'true') {
      throw new HttpError(503, 'summary_generation_disabled')
    }

    const requestId = randomUUID()
    const decision = await withYandexActorSession(this.pool, session, async (client) => {
      const rows = await client.query<GuardRow>(`
        select public.claim_training_summary_generation($1, $2, $3, $4, $5, $6, $7) result
      `, [request.clientId, request.periodStart, request.periodEnd, inputFingerprint,
        requestId, sourceInputChars, modelInputChars])
      return generationDecision(rows[0]?.result)
    })
    console.info('summary generation guard decision', {
      request_id: requestId,
      decision,
      fingerprint_prefix: inputFingerprint.slice(0, 12),
      force_requested: request.force,
      source_input_chars: sourceInputChars,
      model_input_chars: modelInputChars,
    })
    if (decision === 'cached') {
      const racedCache = await withYandexActorSession(
        this.pool,
        session,
        (client) => this.readCache(client, request, source.actor, inputFingerprint),
      )
      if (racedCache !== undefined) return { data: racedCache, cached: true }
      throw new PilotTrainingSummaryError(409, 'summary_generation_in_progress')
    }
    if (decision === 'in_progress') {
      throw new PilotTrainingSummaryError(409, 'summary_generation_in_progress')
    }
    if (decision === 'cooldown') {
      throw new PilotTrainingSummaryError(429, 'summary_generation_cooldown')
    }
    if (decision === 'period_limit') {
      throw new PilotTrainingSummaryError(429, 'summary_generation_period_limit')
    }
    if (decision === 'daily_limit') {
      throw new PilotTrainingSummaryError(429, 'summary_generation_daily_limit')
    }

    let generated
    try {
      console.info('summary model request started', {
        request_id: requestId,
        fingerprint_prefix: inputFingerprint.slice(0, 12),
        model_input_chars: modelInputChars,
        model_calls: 1,
      })
      generated = await requestYandexSummary(
        modelInput,
        source.trainingData.period.start,
        source.trainingData.period.end,
        { requestId, ...(this.authorization === undefined ? {} : { authorization: this.authorization }) },
      )
      console.info('summary model request completed', {
        request_id: requestId,
        fingerprint_prefix: inputFingerprint.slice(0, 12),
        total_tokens: generated.usage.totalTokens ?? null,
        input_tokens: generated.usage.inputTextTokens ?? null,
        output_tokens: generated.usage.completionTokens ?? null,
      })
    } catch (error) {
      await this.failGeneration(session, request, inputFingerprint, requestId, error)
      throw error
    }
    const generatedAt = new Date().toISOString()
    const generatedClientSummary = {
      ...generated.summary.client,
      analysisVersion: SUMMARY_ANALYSIS_VERSION,
      inputFingerprint,
    }
    const displayMetrics = {
      ...source.trainingData.consistency,
      progress_facts: buildSummaryProgressFacts(source.trainingData.exercises),
    }
    const inputStats = {
      workouts: source.workouts,
      exercises: source.exercises,
      sets: source.sets,
      source_input_chars: sourceInputChars,
      model_input_chars: modelInputChars,
      aggregation_version: SUMMARY_AGGREGATOR_VERSION,
      model_version: generated.modelVersion,
    }
    let saved: unknown
    try {
      saved = await withYandexActorSession(this.pool, session, async (client) => {
        const rows = await client.query<JsonRow>(`
          select public.save_generated_training_summary(
            $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb,
            $8, $9, $10, $11::jsonb, $12::jsonb, $13
          ) result
        `, [
          request.clientId, request.periodStart, request.periodEnd,
          trainerSummaryAsText(generated.summary.trainer),
          JSON.stringify(generated.summary.trainer), JSON.stringify(generatedClientSummary),
          JSON.stringify(displayMetrics), generated.modelUri, PROMPT_VERSION,
          inputFingerprint, JSON.stringify(inputStats), JSON.stringify(generated.usage), generatedAt,
        ])
        if (rows[0] === undefined) throw new Error('Training summary save returned no result')
        return rows[0].result
      })
    } catch (error) {
      await this.failGeneration(session, request, inputFingerprint, requestId, error, generated.usage)
      throw error
    }
    await withYandexActorSession(this.pool, session, async (client) => {
      await client.query(`select public.complete_training_summary_generation($1, $2, $3, $4, $5, $6::jsonb)`, [
        request.clientId, request.periodStart, request.periodEnd, inputFingerprint,
        requestId, JSON.stringify(generated.usage),
      ])
    })
    return { data: saved, cached: false }
  }

  private async failGeneration(
    session: YandexActorSessionInput,
    request: TrainingSummaryRequest,
    inputFingerprint: string,
    requestId: string,
    error: unknown,
    fallbackUsage: Record<string, string> = {},
  ): Promise<void> {
    const code = error instanceof Error ? error.message : 'summary_generation_failed'
    const usage = error instanceof HttpError ? error.tokenUsage : fallbackUsage
    try {
      console.warn('summary model request failed', {
        request_id: requestId,
        fingerprint_prefix: inputFingerprint.slice(0, 12),
        code,
        total_tokens: usage.totalTokens ?? null,
      })
      await withYandexActorSession(this.pool, session, async (client) => {
        await client.query(`select public.fail_training_summary_generation($1, $2, $3, $4, $5, $6, $7::jsonb)`, [
          request.clientId, request.periodStart, request.periodEnd, inputFingerprint,
          requestId, code, JSON.stringify(usage),
        ])
      })
    } catch (guardError) {
      console.error('Training summary generation failure could not be recorded', {
        request_id: requestId,
        code,
        guard_error: guardError instanceof Error ? guardError.message : 'unknown',
      })
    }
  }

  async publish(
    session: YandexActorSession,
    summaryId: string,
    clientSummary: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<void> {
    try {
      await withYandexActorSession(this.pool, session, async (client) => {
        const rows = await client.query<QueryResultRow>(`
          select * from public.publish_training_summary($1, $2::jsonb, $3)
        `, [summaryId, JSON.stringify(clientSummary), expectedVersion])
        if (rows.length === 0) {
          throw new PilotTrainingSummaryError(409, 'training_summary_conflict')
        }
      })
    } catch (error) {
      if (error instanceof PilotTrainingSummaryError) throw error
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : ''
      if (code === 'PT404') throw new PilotTrainingSummaryError(404, 'training_summary_not_found')
      if (code === 'PT409') throw new PilotTrainingSummaryError(409, 'training_summary_conflict')
      throw error
    }
  }

  async unpublish(
    session: YandexActorSession,
    summaryId: string,
    expectedVersion: number,
  ): Promise<void> {
    try {
      await withYandexActorSession(this.pool, session, async (client) => {
        const rows = await client.query<{ version: string }>(`
          select public.unpublish_training_summary($1, $2) version
        `, [summaryId, expectedVersion])
        if (Number(rows[0]?.version) !== expectedVersion + 1) {
          throw new PilotTrainingSummaryError(409, 'training_summary_conflict')
        }
      })
    } catch (error) {
      if (error instanceof PilotTrainingSummaryError) throw error
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : ''
      if (code === 'PT404') throw new PilotTrainingSummaryError(404, 'training_summary_not_found')
      if (code === 'PT409') throw new PilotTrainingSummaryError(409, 'training_summary_conflict')
      throw error
    }
  }

  private async readActor(client: DatabaseClient, clientId: string): Promise<'client' | 'trainer'> {
    const rows = await client.query<ClientRow>(`
      select client.auth_user_id, client.goal, client.trainer_id
      from public.clients client
      where client.id = $1 and client.archived_at is null
    `, [clientId])
    const row = rows[0]
    if (row === undefined) throw new PilotTrainingSummaryError(404, 'client_not_found')
    const actorRows = await client.query<{ actor_id: string | null }>(
      'select auth.uid() actor_id',
    )
    return actorRows[0]?.actor_id === row.auth_user_id ? 'client' : 'trainer'
  }

  private async readSource(client: DatabaseClient, request: TrainingSummaryRequest) {
    const clientRows = await client.query<ClientRow>(`
      select item.auth_user_id, item.goal, item.trainer_id
      from public.clients item
      where item.id = $1 and item.archived_at is null
    `, [request.clientId])
    const clientRow = clientRows[0]
    if (clientRow === undefined) throw new PilotTrainingSummaryError(404, 'client_not_found')
    const actor = await this.readActor(client, request.clientId)
    const periodDays = inclusivePeriodDays(request.periodStart, request.periodEnd)
    const previousPeriodEnd = addUtcDays(request.periodStart, -1)
    const previousPeriodStart = addUtcDays(previousPeriodEnd, -(periodDays - 1))
    const goalRows = await client.query<GoalRow>(`
      select jsonb_build_object(
        'title', goal.title, 'targetDate', goal.target_date,
        'stages', coalesce((select jsonb_agg(jsonb_build_object(
          'title', stage.title, 'startsOn', stage.starts_on, 'endsOn', stage.ends_on
        ) order by stage.position, stage.starts_on, stage.id)
        from public.goal_stages stage where stage.goal_id = goal.id), '[]'::jsonb)
      ) goal
      from public.client_goals goal
      where goal.client_id = $1 and goal.status = 'active'
    `, [request.clientId])
    const firstRows = await client.query<FirstWorkoutRow>(`
      select workout.workout_date
      from public.workouts workout
      where workout.client_id = $1 and workout.status = 'done'
        and workout.deleted_at is null and workout.workout_date <= $2
      order by workout.workout_date, workout.id limit 1
    `, [request.clientId, request.periodEnd])
    const allWorkoutRows = await client.query<WorkoutRow>(`
      select workout.id, workout.workout_date, workout.status, workout.deleted_at,
        workout.session_rpe, workout.wellbeing, workout.discomfort, workout.client_comment
      from public.workouts workout
      where workout.client_id = $1 and workout.status = 'done'
        and workout.deleted_at is null
        and workout.workout_date between $2 and $3
      order by workout.workout_date, workout.id limit $4
    `, [request.clientId, previousPeriodStart, request.periodEnd, MAX_SOURCE_ROWS + 1])
    if (allWorkoutRows.length > MAX_SOURCE_ROWS) {
      throw new PilotTrainingSummaryError(422, 'source_row_limit_reached')
    }
    const workoutRows = allWorkoutRows.filter((row) => row.workout_date >= request.periodStart)
    const previousWorkoutRows = allWorkoutRows.filter((row) => row.workout_date <= previousPeriodEnd)
    if (workoutRows.length === 0) throw new PilotTrainingSummaryError(422, 'no_completed_workouts')
    const workoutIds = allWorkoutRows.map((row) => row.id)
    const exerciseRows = await client.query<ExerciseRow>(`
      select exercise.id, exercise.workout_id, exercise.exercise_ref,
        exercise.exercise_name, exercise.exercise_source, exercise.muscle_group,
        exercise.input_kind, exercise.position
      from public.workout_exercises exercise
      where exercise.workout_id = any($1::uuid[])
      order by exercise.workout_id, exercise.position, exercise.id limit $2
    `, [workoutIds, MAX_SOURCE_ROWS + 1])
    if (exerciseRows.length > MAX_SOURCE_ROWS) {
      throw new PilotTrainingSummaryError(422, 'source_row_limit_reached')
    }
    const exerciseIds = exerciseRows.map((row) => row.id)
    const rawSets = exerciseIds.length === 0 ? [] : await client.query<SetRow>(`
      select workout_set.workout_exercise_id, workout_set.position,
        workout_set.plan_weight_kg, workout_set.plan_reps,
        workout_set.plan_duration_min, workout_set.plan_duration_sec,
        workout_set.plan_distance_km, workout_set.plan_rpe,
        workout_set.fact_weight_kg, workout_set.fact_reps,
        workout_set.fact_duration_min, workout_set.fact_duration_sec,
        workout_set.fact_distance_km, workout_set.fact_rpe, workout_set.confirmed_at
      from public.workout_sets workout_set
      where workout_set.workout_exercise_id = any($1::uuid[])
      order by workout_set.workout_exercise_id, workout_set.position, workout_set.id limit $2
    `, [exerciseIds, MAX_SOURCE_ROWS + 1])
    if (rawSets.length > MAX_SOURCE_ROWS) {
      throw new PilotTrainingSummaryError(422, 'source_row_limit_reached')
    }
    const sets = rawSets.map((row): SetRow => ({
      ...row,
      plan_weight_kg: asNumber(row.plan_weight_kg),
      plan_reps: asNumber(row.plan_reps),
      plan_duration_min: asNumber(row.plan_duration_min),
      plan_duration_sec: asNumber(row.plan_duration_sec),
      plan_distance_km: asNumber(row.plan_distance_km),
      plan_rpe: asNumber(row.plan_rpe),
      fact_weight_kg: asNumber(row.fact_weight_kg),
      fact_reps: asNumber(row.fact_reps),
      fact_duration_min: asNumber(row.fact_duration_min),
      fact_duration_sec: asNumber(row.fact_duration_sec),
      fact_distance_km: asNumber(row.fact_distance_km),
      fact_rpe: asNumber(row.fact_rpe),
    }))
    const measurementRows = await client.query<ProgressRow>(`
      select progress.recorded_on, progress.weight_kg, progress.chest_cm,
        progress.waist_cm, progress.hip_cm
      from public.client_progress progress
      where progress.client_id = $1 and progress.deleted_at is null
        and progress.recorded_on between $2 and $3
      order by progress.recorded_on, progress.id limit $4
    `, [request.clientId, previousPeriodStart, request.periodEnd, MAX_SOURCE_ROWS + 1])
    if (measurementRows.length > MAX_SOURCE_ROWS) {
      throw new PilotTrainingSummaryError(422, 'source_row_limit_reached')
    }
    const measurements = measurementRows.map((row) => ({
      recorded_on: row.recorded_on,
      weight_kg: asNumber(row.weight_kg),
      chest_cm: asNumber(row.chest_cm),
      waist_cm: asNumber(row.waist_cm),
      hip_cm: asNumber(row.hip_cm),
    }))
    const currentMeasurements = measurements.filter((row) => row.recorded_on >= request.periodStart)
    const previousMeasurements = measurements.filter((row) => row.recorded_on <= previousPeriodEnd)
    const currentWorkoutIds = new Set(workoutRows.map((row) => row.id))
    const previousWorkoutIds = new Set(previousWorkoutRows.map((row) => row.id))
    const currentExercises = exerciseRows.filter((row) => currentWorkoutIds.has(row.workout_id))
    const previousExercises = exerciseRows.filter((row) => previousWorkoutIds.has(row.workout_id))
    const currentExerciseIds = new Set(currentExercises.map((row) => row.id))
    const previousExerciseIds = new Set(previousExercises.map((row) => row.id))
    const progress = buildProgressData(
      workoutRows,
      currentExercises,
      sets.filter((row) => currentExerciseIds.has(row.workout_exercise_id)),
      request.periodStart,
      request.periodEnd,
      firstRows[0]?.workout_date ?? null,
    )
    const previousProgress = previousWorkoutRows.length > 0 || previousMeasurements.length > 0
      ? buildProgressData(
          previousWorkoutRows,
          previousExercises,
          sets.filter((row) => previousExerciseIds.has(row.workout_exercise_id)),
          previousPeriodStart,
          previousPeriodEnd,
          firstRows[0]?.workout_date && firstRows[0].workout_date <= previousPeriodEnd
            ? firstRows[0].workout_date
            : null,
        )
      : null
    return {
      actor,
      trainingData: {
        ...progress,
        goal: buildTrainingGoalContext(clientRow.goal, goalRows[0]?.goal, request.periodEnd),
        measurements: currentMeasurements,
        previous_period: previousProgress === null ? null : {
          ...previousProgress,
          measurements: previousMeasurements,
        },
      },
      workouts: allWorkoutRows.length,
      exercises: exerciseRows.length,
      sets: sets.length,
    }
  }

  private async readCache(
    client: DatabaseClient,
    request: TrainingSummaryRequest,
    actor: 'client' | 'trainer',
    inputFingerprint: string,
  ): Promise<unknown> {
    const rows = actor === 'client'
      ? await client.query<SummaryRow>(`
          select summary.input_fingerprint, jsonb_build_object(
            'id', summary.id, 'source_summary_id', summary.source_summary_id,
            'client_id', summary.client_id, 'period_start', summary.period_start,
            'period_end', summary.period_end, 'summary', summary.summary,
            'display_metrics', summary.display_metrics,
            'generated_at', summary.generated_at, 'published_at', summary.published_at
          ) result
          from public.client_published_training_summaries summary
          where summary.client_id = $1 and summary.period_start = $2 and summary.period_end = $3
        `, [request.clientId, request.periodStart, request.periodEnd])
      : await client.query<SummaryRow>(`
          select summary.input_fingerprint, jsonb_build_object(
            'id', summary.id, 'client_id', summary.client_id,
            'period_start', summary.period_start, 'period_end', summary.period_end,
            'trainer_summary', summary.trainer_summary,
            'client_summary', summary.client_summary,
            'display_metrics', summary.display_metrics,
            'generated_at', summary.generated_at, 'version', summary.version
          ) result
          from public.client_training_summaries summary
          where summary.client_id = $1 and summary.period_start = $2
            and summary.period_end = $3 and summary.prompt_version = $4
        `, [request.clientId, request.periodStart, request.periodEnd, PROMPT_VERSION])
    return rows[0]?.input_fingerprint === inputFingerprint ? rows[0].result : undefined
  }
}
