import { createHash, randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'

import type { DatabaseClient, DatabasePool } from './db/types.js'
import {
  buildProgressData,
  requestYandexSummary,
  trainerSummaryAsText,
  type ExerciseRow,
  type SetRow,
  type WorkoutRow,
} from './legacy-summary/index.js'
import { buildTrainingGoalContext } from './legacy-summary/summary-goal.js'
import { buildSummaryModelInput } from './legacy-summary/summary-model-input.js'
import { buildSummaryProgressFacts } from './legacy-summary/summary-progress-facts.js'
import { PROMPT_VERSION } from './legacy-summary/summary-contract.js'
import type { YandexAiAuthorization } from './yandex-ai-authorization.js'
import {
  withYandexActorSession,
  type YandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'

const MAX_SOURCE_ROWS = 1000

interface ClientRow extends QueryResultRow {
  auth_user_id: string | null
  goal: string | null
  trainer_id: string
}
interface GoalRow extends QueryResultRow {
  goal: unknown
}
interface FirstWorkoutRow extends QueryResultRow { workout_date: string }
interface SummaryRow extends QueryResultRow {
  input_fingerprint: string
  result: unknown
}
interface JsonRow extends QueryResultRow { result: unknown }

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
    const inputFingerprint = fingerprint(source.trainingData)
    if (!request.force) {
      const cached = await withYandexActorSession(
        this.pool,
        session,
        (client) => this.readCache(client, request, source.actor, inputFingerprint),
      )
      if (cached !== undefined) return { data: cached, cached: true }
    }

    const requestId = randomUUID()
    const generated = await requestYandexSummary(
      buildSummaryModelInput(source.trainingData),
      source.trainingData.period.start,
      source.trainingData.period.end,
      { requestId, ...(this.authorization === undefined ? {} : { authorization: this.authorization }) },
    )
    const generatedAt = new Date().toISOString()
    const displayMetrics = {
      ...source.trainingData.consistency,
      progress_facts: buildSummaryProgressFacts(source.trainingData.exercises),
    }
    const inputStats = {
      workouts: source.workouts,
      exercises: source.exercises,
      sets: source.sets,
      model_version: generated.modelVersion,
    }
    const saved = await withYandexActorSession(this.pool, session, async (client) => {
      const rows = await client.query<JsonRow>(`
        select public.save_generated_training_summary(
          $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb,
          $8, $9, $10, $11::jsonb, $12::jsonb, $13
        ) result
      `, [
        request.clientId, request.periodStart, request.periodEnd,
        trainerSummaryAsText(generated.summary.trainer),
        JSON.stringify(generated.summary.trainer), JSON.stringify(generated.summary.client),
        JSON.stringify(displayMetrics), generated.modelUri, PROMPT_VERSION,
        inputFingerprint, JSON.stringify(inputStats), JSON.stringify(generated.usage), generatedAt,
      ])
      if (rows[0] === undefined) throw new Error('Training summary save returned no result')
      return rows[0].result
    })
    return { data: saved, cached: false }
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
    const workoutRows = await client.query<WorkoutRow>(`
      select workout.id, workout.workout_date, workout.status, workout.deleted_at
      from public.workouts workout
      where workout.client_id = $1 and workout.status = 'done'
        and workout.deleted_at is null
        and workout.workout_date between $2 and $3
      order by workout.workout_date, workout.id limit $4
    `, [request.clientId, request.periodStart, request.periodEnd, MAX_SOURCE_ROWS + 1])
    if (workoutRows.length === 0) throw new PilotTrainingSummaryError(422, 'no_completed_workouts')
    if (workoutRows.length > MAX_SOURCE_ROWS) {
      throw new PilotTrainingSummaryError(422, 'source_row_limit_reached')
    }
    const workoutIds = workoutRows.map((row) => row.id)
    const exerciseRows = await client.query<ExerciseRow>(`
      select exercise.id, exercise.workout_id, exercise.exercise_ref,
        exercise.exercise_name, exercise.input_kind, exercise.position
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
        workout_set.fact_weight_kg, workout_set.fact_reps,
        workout_set.fact_duration_min, workout_set.fact_duration_sec,
        workout_set.fact_distance_km
      from public.workout_sets workout_set
      where workout_set.workout_exercise_id = any($1::uuid[])
        and workout_set.confirmed_at is not null
      order by workout_set.workout_exercise_id, workout_set.position, workout_set.id limit $2
    `, [exerciseIds, MAX_SOURCE_ROWS + 1])
    if (rawSets.length > MAX_SOURCE_ROWS) {
      throw new PilotTrainingSummaryError(422, 'source_row_limit_reached')
    }
    const sets = rawSets.map((row): SetRow => ({
      ...row,
      fact_weight_kg: asNumber(row.fact_weight_kg),
      fact_reps: asNumber(row.fact_reps),
      fact_duration_min: asNumber(row.fact_duration_min),
      fact_duration_sec: asNumber(row.fact_duration_sec),
      fact_distance_km: asNumber(row.fact_distance_km),
    }))
    const progress = buildProgressData(
      workoutRows,
      exerciseRows,
      sets,
      request.periodStart,
      request.periodEnd,
      firstRows[0]?.workout_date ?? null,
    )
    return {
      actor,
      trainingData: {
        ...progress,
        goal: buildTrainingGoalContext(clientRow.goal, goalRows[0]?.goal, request.periodEnd),
      },
      workouts: workoutRows.length,
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
