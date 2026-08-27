import { createHash } from 'node:crypto'

import type { QueryResultRow } from 'pg'

import { createPilotSessionToken } from '../auth/pilot-session-token.js'
import type { DatabaseClient, DatabasePool } from './types.js'

const FIXTURE_NAMESPACE = 'fit-yandex-stage-workout-read-model-v1'
const MAX_STAGE_TRAINERS = 25
const PILOT_SESSION_TTL_MS = 15 * 60 * 1_000

interface TrainerRow extends QueryResultRow {
  profile_id: string
}

export interface StageWorkoutFixtureIds {
  clientId: string
  clientActorId: string
  customExerciseId: string
  workoutId: string
  strengthExerciseId: string
  runningExerciseId: string
  strengthBlockId: string
  runningBlockId: string
  strengthSetId: string
  runningSetId: string
  progressId: string
  progressMetricId: string
  progressCustomValueId: string
  goalId: string
  goalStageId: string
}

export interface StageWorkoutFixtureResult {
  seededTrainerCount: number
  clientId: string
  sessionToken: string
  sessionExpiresAt: string
  clientSessionToken: string
  clientSessionExpiresAt: string
}

export interface StageWorkoutFixtureLoader {
  load(): Promise<StageWorkoutFixtureResult>
}

function deterministicUuid(seed: string): string {
  const hex = createHash('sha256')
    .update(`${FIXTURE_NAMESPACE}:${seed}`, 'utf8')
    .digest('hex')
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8)
    .toString(16)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

export const STAGE_SMOKE_PROFILE_ID = deterministicUuid('smoke-profile')

export function stageWorkoutFixtureIds(
  trainerId: string,
): StageWorkoutFixtureIds {
  return {
    clientId: deterministicUuid(`${trainerId}:client`),
    clientActorId: deterministicUuid(`${trainerId}:client-actor`),
    customExerciseId: deterministicUuid(`${trainerId}:custom-exercise`),
    workoutId: deterministicUuid(`${trainerId}:workout`),
    strengthExerciseId: deterministicUuid(`${trainerId}:strength-exercise`),
    runningExerciseId: deterministicUuid(`${trainerId}:running-exercise`),
    strengthBlockId: deterministicUuid(`${trainerId}:strength-block`),
    runningBlockId: deterministicUuid(`${trainerId}:running-block`),
    strengthSetId: deterministicUuid(`${trainerId}:strength-set`),
    runningSetId: deterministicUuid(`${trainerId}:running-set`),
    progressId: deterministicUuid(`${trainerId}:progress`),
    progressMetricId: deterministicUuid(`${trainerId}:progress-metric`),
    progressCustomValueId: deterministicUuid(`${trainerId}:progress-custom-value`),
    goalId: deterministicUuid(`${trainerId}:goal`),
    goalStageId: deterministicUuid(`${trainerId}:goal-stage`),
  }
}

async function seedTrainerFixture(
  client: DatabaseClient,
  trainerId: string,
): Promise<void> {
  const ids = stageWorkoutFixtureIds(trainerId)

  await client.query(
    `
      insert into public.profiles (id, first_name, account_role)
      values ($1, 'Stage smoke client', 'client')
      on conflict (id) do update set account_role = excluded.account_role
    `,
    [ids.clientActorId],
  )
  await client.query(
    `
      insert into app_private.profile_rollout_assignments (
        profile_id, target_backend, access_mode, enabled
      ) values ($1, 'yandex', 'read_only', true)
      on conflict (profile_id) do update set
        target_backend = excluded.target_backend,
        access_mode = excluded.access_mode,
        enabled = excluded.enabled
    `,
    [ids.clientActorId],
  )

  await client.query(
    `
      delete from public.workouts
      where client_id = $1
        and notes like 'Синтетическая проверка versioned mutation%'
    `,
    [ids.clientId],
  )
  await client.query(
    `
      delete from public.custom_exercises
      where trainer_id = $1
        and name like 'Синтетическое упражнение domain smoke%'
    `,
    [trainerId],
  )
  await client.query('delete from public.client_goals where client_id = $1', [ids.clientId])
  await client.query('delete from public.client_progress where client_id = $1', [ids.clientId])
  await client.query('delete from public.client_custom_metrics where client_id = $1', [ids.clientId])
  await client.query(
    `
      delete from public.clients
      where trainer_id = $1
        and full_name = 'Синтетический клиент domain smoke'
    `,
    [trainerId],
  )

  await client.query(
    `
      insert into public.clients (
        id, trainer_id, auth_user_id, full_name, gender, age_years,
        height_cm, goal
      ) values (
        $1, $2, $3, 'Тестовый клиент Yandex stage', 'female', 30, 170,
        'Проверка read-only переноса'
      )
      on conflict (id) do update set auth_user_id = excluded.auth_user_id
    `,
    [ids.clientId, trainerId, ids.clientActorId],
  )
  await client.query(
    `
      insert into public.client_trainers (client_id, trainer_id, alias)
      values ($1, $2, 'Тестовый клиент Yandex stage')
      on conflict (client_id, trainer_id) do nothing
    `,
    [ids.clientId, trainerId],
  )
  await client.query(
    `
      insert into public.custom_exercises (
        id, trainer_id, name, muscle_group, input_kind
      ) values (
        $1, $2, 'Тестовая тяга Yandex stage', 'back', 'strength'
      )
      on conflict (id) do nothing
    `,
    [ids.customExerciseId, trainerId],
  )
  await client.query(
    `
      insert into public.workouts (
        id, trainer_id, client_id, created_by, workout_date, start_time,
        end_time, status, notes, started_at, completed_at
      ) values (
        $1, $2, $3, $2, date '2026-08-22', time '10:00', time '11:00',
        'done', 'Синтетическая проверка переноса Yandex stage',
        timestamptz '2026-08-22 07:00:00+00',
        timestamptz '2026-08-22 08:00:00+00'
      )
      on conflict (id) do update set
        session_rpe = null,
        wellbeing = null,
        discomfort = null,
        client_comment = null,
        feedback_submitted_at = null,
        trainer_reaction = null,
        trainer_review = null,
        trainer_review_author_id = null,
        trainer_reviewed_at = null,
        client_question = null,
        client_question_asked_at = null,
        client_question_resolved_at = null,
        version = 1
    `,
    [ids.workoutId, trainerId, ids.clientId],
  )
  await client.query(
    `
      insert into public.workout_exercises (
        id, workout_id, trainer_id, client_id, position, exercise_source,
        exercise_ref, custom_exercise_id, exercise_name, muscle_group,
        input_kind, block_id, block_type, block_preset, block_rounds,
        rest_between_sets_sec, trainer_comment
      ) values (
        $1, $3, $4, $5, 0, 'custom', $6, $2,
        'Тестовая тяга Yandex stage', 'back', 'strength', $7,
        'single', 'set', 1, 90, 'Проверка весов и повторов'
      ), (
        $8, $3, $4, $5, 1, 'system', 'running', null,
        'Бег', 'cardio', 'distance', $9,
        'single', 'interval', 1, 60, 'Проверка времени и дистанции'
      )
      on conflict (id) do nothing
    `,
    [
      ids.strengthExerciseId,
      ids.customExerciseId,
      ids.workoutId,
      trainerId,
      ids.clientId,
      `custom:${ids.customExerciseId}`,
      ids.strengthBlockId,
      ids.runningExerciseId,
      ids.runningBlockId,
    ],
  )
  await client.query(
    `
      insert into public.workout_sets (
        id, workout_exercise_id, trainer_id, client_id, position,
        plan_weight_kg, plan_reps, plan_rpe,
        fact_weight_kg, fact_reps, fact_rpe, confirmed_at
      ) values (
        $1, $2, $3, $4, 0, 40, 10, 7, 42.5, 10, 8,
        timestamptz '2026-08-22 07:30:00+00'
      )
      on conflict (id) do nothing
    `,
    [ids.strengthSetId, ids.strengthExerciseId, trainerId, ids.clientId],
  )
  await client.query(
    `
      insert into public.workout_sets (
        id, workout_exercise_id, trainer_id, client_id, position,
        plan_duration_sec, plan_distance_km, plan_rpe,
        fact_duration_sec, fact_distance_km, fact_rpe, confirmed_at
      ) values (
        $1, $2, $3, $4, 0, 1800, 5, 7, 1740, 5.2, 8,
        timestamptz '2026-08-22 08:00:00+00'
      )
      on conflict (id) do nothing
    `,
    [ids.runningSetId, ids.runningExerciseId, trainerId, ids.clientId],
  )
  await client.query('delete from public.client_goals where client_id = $1', [ids.clientId])
  await client.query('delete from public.client_progress where client_id = $1', [ids.clientId])
  await client.query('delete from public.client_custom_metrics where client_id = $1', [ids.clientId])
  await client.query(
    `insert into public.client_custom_metrics (
       id, trainer_id, client_id, created_by, name, unit
     ) values ($1, $2, $3, $2, 'Процент жира', '%')`,
    [ids.progressMetricId, trainerId, ids.clientId],
  )
  await client.query(
    `insert into public.client_progress (
       id, trainer_id, client_id, created_by, recorded_on, weight_kg, waist_cm, notes
     ) values ($1, $2, $3, $2, date '2026-08-22', 64.5, 72, 'Синтетический замер stage')`,
    [ids.progressId, trainerId, ids.clientId],
  )
  await client.query(
    `insert into public.client_progress_custom (
       id, trainer_id, client_id, progress_id, metric_id, value
     ) values ($1, $2, $3, $4, $5, 19.5)`,
    [ids.progressCustomValueId, trainerId, ids.clientId, ids.progressId, ids.progressMetricId],
  )
  await client.query(
    `insert into public.client_goals (
       id, trainer_id, client_id, created_by, title, target_date
     ) values ($1, $2, $3, $2, 'Подтянуться 10 раз', date '2026-12-31')`,
    [ids.goalId, trainerId, ids.clientId],
  )
  await client.query(
    `insert into public.goal_stages (
       id, goal_id, trainer_id, client_id, created_by, title,
       starts_on, ends_on, position
     ) values ($1, $2, $3, $4, $3, 'Первые пять', date '2026-08-22', date '2026-10-01', 0)`,
    [ids.goalStageId, ids.goalId, trainerId, ids.clientId],
  )
}

export class DatabaseStageWorkoutFixtureLoader
implements StageWorkoutFixtureLoader {
  constructor(
    private readonly pool: DatabasePool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<StageWorkoutFixtureResult> {
    const connection = await this.pool.connect()
    let transactionStarted = false

    try {
      await connection.query('begin')
      transactionStarted = true
      await connection.query(
        'select pg_advisory_xact_lock(hashtextextended($1, 0))',
        [FIXTURE_NAMESPACE],
      )

      await connection.query(
        `
          insert into public.profiles (id, first_name, account_role)
          values ($1, 'Stage smoke', 'trainer')
          on conflict (id) do nothing
        `,
        [STAGE_SMOKE_PROFILE_ID],
      )
      await connection.query(
        `
          insert into public.trainers (profile_id)
          values ($1)
          on conflict (profile_id) do nothing
        `,
        [STAGE_SMOKE_PROFILE_ID],
      )
      await connection.query(
        `
          insert into app_private.profile_rollout_assignments (
            profile_id, target_backend, access_mode, enabled
          ) values ($1, 'yandex', 'read_only', true)
          on conflict (profile_id) do update set
            target_backend = excluded.target_backend,
            access_mode = excluded.access_mode,
            enabled = excluded.enabled
        `,
        [STAGE_SMOKE_PROFILE_ID],
      )

      const trainers = await connection.query<TrainerRow>(
        `
          select trainer.profile_id
          from public.trainers trainer
          join app_private.profile_rollout_assignments rollout
            on rollout.profile_id = trainer.profile_id
          where rollout.target_backend = 'yandex'
            and rollout.access_mode = 'read_only'
            and rollout.enabled
          order by trainer.profile_id
          limit $1
        `,
        [MAX_STAGE_TRAINERS + 1],
      )
      if (trainers.length > MAX_STAGE_TRAINERS) {
        throw new Error('Stage fixture trainer limit exceeded')
      }

      for (const trainer of trainers) {
        await seedTrainerFixture(connection, trainer.profile_id)
      }

      const session = createPilotSessionToken()
      const clientSession = createPilotSessionToken()
      const expiresAt = new Date(this.now().getTime() + PILOT_SESSION_TTL_MS)
      const smokeIds = stageWorkoutFixtureIds(STAGE_SMOKE_PROFILE_ID)
      await connection.query(
        `
          delete from app_private.yandex_pilot_sessions
          where profile_id in ($1, $2) and expires_at <= now()
        `,
        [STAGE_SMOKE_PROFILE_ID, smokeIds.clientActorId],
      )
      await connection.query(
        `
          insert into app_private.yandex_pilot_sessions (
            token_sha256, profile_id, expires_at
          ) values ($1, $2, $3)
        `,
        [session.sha256, STAGE_SMOKE_PROFILE_ID, expiresAt],
      )
      await connection.query(
        `
          insert into app_private.yandex_pilot_sessions (
            token_sha256, profile_id, expires_at
          ) values ($1, $2, $3)
        `,
        [clientSession.sha256, smokeIds.clientActorId, expiresAt],
      )

      await connection.query('commit')
      return {
        seededTrainerCount: trainers.length,
        clientId: smokeIds.clientId,
        sessionToken: session.raw,
        sessionExpiresAt: expiresAt.toISOString(),
        clientSessionToken: clientSession.raw,
        clientSessionExpiresAt: expiresAt.toISOString(),
      }
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.query('rollback')
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Stage fixture transaction and rollback both failed',
            { cause: rollbackError },
          )
        }
      }
      throw error
    } finally {
      connection.release()
    }
  }
}
