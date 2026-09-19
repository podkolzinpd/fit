import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QueryResultRow } from 'pg'
import { buildTrainingGoalContext } from '../../legacy-summary/summary-goal.js'
import type { DatabaseClient } from '../../db/types.js'
import { buildProgramHistoryContext, type ProgramContextSource } from './context.js'
import { addDays } from './generate.js'

type Row = Record<string, unknown>
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('program_source_invalid')
  return value as Row[]
}
function string(row: Row, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error('program_source_invalid')
  return value
}
function numberOrNull(row: Row, key: string): number | null {
  if (row[key] === null || row[key] === undefined) return null
  const value = typeof row[key] === 'number' ? row[key] : typeof row[key] === 'string' && row[key].trim() ? Number(row[key]) : NaN
  if (!Number.isFinite(value)) throw new Error('program_source_invalid')
  return value
}

async function pages(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const result: Row[] = []
  for (let offset = 0; offset <= 10_000; offset += 100) {
    const response = await read(offset, offset + 99)
    if (response.error) throw new Error('program_context_unavailable')
    const batch = rows(response.data)
    result.push(...batch)
    if (result.length > 10_000) throw new Error('program_source_limit_reached')
    if (batch.length < 100) return result
  }
  throw new Error('program_source_limit_reached')
}

/** Uses the actor JWT throughout, including connected-client access through RLS. */
export async function loadProgramContext(actor: SupabaseClient, client: { id: string; ageYears: number | null; goal: string | null }, today: string) {
  const capturedAt = new Date().toISOString()
  const periodStart = addDays(today, -55)
  const workoutRows = await pages((from, to) => actor.from('workouts')
    .select('id,client_id,workout_date,status,deleted_at,session_rpe,wellbeing,discomfort')
    .eq('client_id', client.id).eq('status', 'done').is('deleted_at', null)
    .gte('workout_date', periodStart).lte('workout_date', today).order('id').range(from, to))
  const workoutIds = workoutRows.map((row) => string(row, 'id'))
  const exerciseRows = workoutIds.length ? await pages((from, to) => actor.from('workout_exercises')
    .select('id,workout_id,exercise_source,exercise_ref,position').in('workout_id', workoutIds).order('id').range(from, to)) : []
  const setRows: Row[] = []
  for (let index = 0; index < exerciseRows.length; index += 100) {
    const ids = exerciseRows.slice(index, index + 100).map((row) => string(row, 'id'))
    setRows.push(...await pages((from, to) => actor.from('workout_sets')
      .select('id,workout_exercise_id,position,confirmed_at,fact_reps,fact_weight_kg,fact_duration_sec,fact_duration_min,fact_distance_km,fact_rpe')
      .in('workout_exercise_id', ids).order('id').range(from, to)))
    if (setRows.length > 10_000) throw new Error('program_source_limit_reached')
  }
  const source: ProgramContextSource = {
    clientId: client.id, periodStart, periodEnd: today,
    workouts: workoutRows.map((row) => ({ id: string(row, 'id'), clientId: string(row, 'client_id'), date: string(row, 'workout_date'),
      status: 'done', deletedAt: null, sessionRpe: numberOrNull(row, 'session_rpe'),
      wellbeing: row.wellbeing === 'good' || row.wellbeing === 'normal' || row.wellbeing === 'hard' ? row.wellbeing : null,
      discomfort: typeof row.discomfort === 'boolean' ? row.discomfort : null,
    })),
    exercises: exerciseRows.map((row) => {
      if (row.exercise_source !== 'system' && row.exercise_source !== 'custom') throw new Error('program_source_invalid')
      return { id: string(row, 'id'), workoutId: string(row, 'workout_id'), source: row.exercise_source,
        ref: string(row, 'exercise_ref'), position: numberOrNull(row, 'position') ?? 0 }
    }),
    sets: setRows.map((row) => ({ id: string(row, 'id'), exerciseId: string(row, 'workout_exercise_id'), position: numberOrNull(row, 'position') ?? 0,
      confirmedAt: typeof row.confirmed_at === 'string' ? row.confirmed_at : null,
      factReps: numberOrNull(row, 'fact_reps'), factWeightKg: numberOrNull(row, 'fact_weight_kg'),
      factDurationSec: numberOrNull(row, 'fact_duration_sec') ?? (row.fact_duration_min == null ? null : numberOrNull(row, 'fact_duration_min')! * 60),
      factDistanceKm: numberOrNull(row, 'fact_distance_km'), factRpe: numberOrNull(row, 'fact_rpe'),
    })),
  }
  const planned = await pages((from, to) => actor.from('workouts').select('id,workout_date')
    .eq('client_id', client.id).eq('status', 'planned').is('deleted_at', null)
    .gte('workout_date', today).lte('workout_date', addDays(today, 118)).order('id').range(from, to))
  const plannedWorkouts = planned.map((row) => ({ id: string(row, 'id'), date: string(row, 'workout_date') }))
  const result = buildProgramHistoryContext(source)
  const [goal, measurement] = await Promise.all([
    actor.rpc('get_client_goal', { p_client_id: client.id }),
    actor.from('client_progress').select('recorded_on,weight_kg').eq('client_id', client.id).is('deleted_at', null)
      .lte('recorded_on', today).order('recorded_on', { ascending: false }).order('id', { ascending: false }).limit(1),
  ])
  if (goal.error || measurement.error) throw new Error('program_context_unavailable')
  const latest = rows(measurement.data)[0]
  const profile = { ageYears: client.ageYears, goal: buildTrainingGoalContext(client.goal, goal.data, today),
    latestWeight: latest ? { date: string(latest, 'recorded_on'), weightKg: numberOrNull(latest, 'weight_kg') } : null }
  return { ...result, capturedAt, profile, plannedWorkouts, fingerprint: createHash('sha256').update(JSON.stringify([result.fingerprint, profile, plannedWorkouts])).digest('hex') }
}

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
) {
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
