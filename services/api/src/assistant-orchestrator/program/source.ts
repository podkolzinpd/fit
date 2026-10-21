import { createHash } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import { buildTrainingGoalContext } from '../../legacy-summary/summary-goal.js'
import type { DatabaseClient } from '../../db/types.js'
import { buildProgramHistoryContext, type ProgramContextSource } from './context.js'
import { addDays } from './generate.js'
import type { ProgramSourceSnapshot } from './source-contract.js'

interface DatabaseRow extends QueryResultRow {
  [key: string]: unknown
}

function databaseString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  throw new Error('program_source_invalid')
}

function databaseDate(value: unknown): string {
  return databaseString(value).slice(0, 10)
}

function databaseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(parsed)) throw new Error('program_source_invalid')
  return parsed
}

async function limitedQuery(
  actor: DatabaseClient,
  query: string,
  values: readonly unknown[],
): Promise<readonly DatabaseRow[]> {
  const result = await actor.query<DatabaseRow>(query, values)
  if (result.length > 10_000) throw new Error('program_source_limit_reached')
  return result
}

/** Reads the same bounded, actor-authorized facts from Yandex PostgreSQL. */
export async function loadDatabaseProgramContext(
  actor: DatabaseClient,
  client: { id: string; ageYears: number | null; goal: string | null },
  today: string,
): Promise<ProgramSourceSnapshot> {
  const capturedAt = new Date().toISOString()
  const periodStart = addDays(today, -55)
  const workoutRows = await limitedQuery(actor, `
    select id, client_id, workout_date, status, deleted_at,
      session_rpe, wellbeing, discomfort
    from public.workouts
    where client_id = $1 and status = 'done' and deleted_at is null
      and workout_date between $2 and $3
    order by id
    limit 10001
  `, [client.id, periodStart, today])
  const workoutIds = workoutRows.map((row) => databaseString(row.id))
  const exerciseRows = workoutIds.length === 0 ? [] : await limitedQuery(actor, `
    select id, workout_id, exercise_source, exercise_ref, position
    from public.workout_exercises
    where workout_id = any($1::uuid[])
    order by id
    limit 10001
  `, [workoutIds])
  const exerciseIds = exerciseRows.map((row) => databaseString(row.id))
  const setRows = exerciseIds.length === 0 ? [] : await limitedQuery(actor, `
    select id, workout_exercise_id, position, confirmed_at, fact_reps,
      fact_weight_kg, fact_duration_sec, fact_duration_min,
      fact_distance_km, fact_rpe
    from public.workout_sets
    where workout_exercise_id = any($1::uuid[])
    order by id
    limit 10001
  `, [exerciseIds])
  const source: ProgramContextSource = {
    clientId: client.id,
    periodStart,
    periodEnd: today,
    workouts: workoutRows.map((row) => ({
      id: databaseString(row.id),
      clientId: databaseString(row.client_id),
      date: databaseDate(row.workout_date),
      status: 'done',
      deletedAt: null,
      sessionRpe: databaseNumber(row.session_rpe),
      wellbeing: row.wellbeing === 'good' || row.wellbeing === 'normal' || row.wellbeing === 'hard' ? row.wellbeing : null,
      discomfort: typeof row.discomfort === 'boolean' ? row.discomfort : null,
    })),
    exercises: exerciseRows.map((row) => {
      if (row.exercise_source !== 'system' && row.exercise_source !== 'custom') throw new Error('program_source_invalid')
      return {
        id: databaseString(row.id),
        workoutId: databaseString(row.workout_id),
        source: row.exercise_source,
        ref: databaseString(row.exercise_ref),
        position: databaseNumber(row.position) ?? 0,
      }
    }),
    sets: setRows.map((row) => ({
      id: databaseString(row.id),
      exerciseId: databaseString(row.workout_exercise_id),
      position: databaseNumber(row.position) ?? 0,
      confirmedAt: row.confirmed_at === null ? null : databaseString(row.confirmed_at),
      factReps: databaseNumber(row.fact_reps),
      factWeightKg: databaseNumber(row.fact_weight_kg),
      factDurationSec: databaseNumber(row.fact_duration_sec)
        ?? (row.fact_duration_min == null ? null : databaseNumber(row.fact_duration_min)! * 60),
      factDistanceKm: databaseNumber(row.fact_distance_km),
      factRpe: databaseNumber(row.fact_rpe),
    })),
  }
  const planned = await limitedQuery(actor, `
    select id, workout_date
    from public.workouts
    where client_id = $1 and status = 'planned' and deleted_at is null
      and workout_date between $2 and $3
    order by id
    limit 10001
  `, [client.id, today, addDays(today, 118)])
  const goalRows = await limitedQuery(actor, `
    select id, title, target_date
    from public.client_goals
    where client_id = $1 and status = 'active' and archived_at is null
    order by updated_at desc, id desc
    limit 1
  `, [client.id])
  const goal = goalRows[0]
  const stages = goal === undefined ? [] : await limitedQuery(actor, `
    select title, starts_on, ends_on
    from public.goal_stages
    where goal_id = $1
    order by position, id
    limit 10001
  `, [goal.id])
  const measurements = await limitedQuery(actor, `
    select recorded_on, weight_kg
    from public.client_progress
    where client_id = $1 and deleted_at is null and recorded_on <= $2
    order by recorded_on desc, id desc
    limit 1
  `, [client.id, today])
  const structuredGoal = goal === undefined ? null : {
    title: databaseString(goal.title),
    targetDate: goal.target_date === null ? null : databaseDate(goal.target_date),
    stages: stages.map((stage) => ({
      title: databaseString(stage.title),
      startsOn: databaseDate(stage.starts_on),
      endsOn: databaseDate(stage.ends_on),
    })),
  }
  const latest = measurements[0]
  const profile = {
    ageYears: client.ageYears,
    goal: buildTrainingGoalContext(client.goal, structuredGoal, today),
    latestWeight: latest === undefined ? null : {
      date: databaseDate(latest.recorded_on),
      weightKg: databaseNumber(latest.weight_kg),
    },
  }
  const result = buildProgramHistoryContext(source)
  const plannedWorkouts = planned.map((row) => ({
    id: databaseString(row.id),
    date: databaseDate(row.workout_date),
  }))
  return {
    ...result,
    capturedAt,
    profile,
    plannedWorkouts,
    fingerprint: createHash('sha256')
      .update(JSON.stringify([result.fingerprint, profile, plannedWorkouts]))
      .digest('hex'),
  }
}
