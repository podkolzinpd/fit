import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'

const WORKOUT_PAGE_SIZE = 100

type MuscleGroup =
  | 'legs'
  | 'glutes'
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'arms'
  | 'core'
  | 'cardio'
  | 'other'
type InputKind = 'strength' | 'distance' | 'reps' | 'duration'
type WorkoutStatus = 'planned' | 'in_progress' | 'done' | 'cancelled'
type ExerciseSource = 'system' | 'custom'
type BlockType = 'single' | 'group'
type BlockPreset = 'set' | 'circuit' | 'interval'

interface CustomExerciseRow extends QueryResultRow {
  id: string
  name: string
  muscle_group: MuscleGroup
  input_kind: InputKind
  archived_at: Date | null
  version: string
}

interface WorkoutRow extends QueryResultRow {
  id: string
  trainer_id: string
  client_id: string
  client_name: string
  created_by: string | null
  workout_date: string
  start_time: string | null
  end_time: string | null
  status: WorkoutStatus
  notes: string | null
  started_at: Date | null
  completed_at: Date | null
  version: string
}

interface WorkoutExerciseRow extends QueryResultRow {
  id: string
  workout_id: string
  position: number
  exercise_source: ExerciseSource
  exercise_ref: string
  custom_exercise_id: string | null
  exercise_name: string
  muscle_group: MuscleGroup
  input_kind: InputKind
  block_id: string
  block_type: BlockType
  block_preset: BlockPreset
  block_rounds: number
  rest_between_exercises_sec: number
  rest_between_rounds_sec: number
  rest_between_sets_sec: number
  trainer_comment: string | null
}

interface WorkoutSetRow extends QueryResultRow {
  id: string
  workout_exercise_id: string
  position: number
  plan_weight_kg: string | null
  plan_reps: number | null
  plan_duration_min: string | null
  plan_duration_sec: number | null
  plan_distance_km: string | null
  plan_rpe: string | null
  fact_weight_kg: string | null
  fact_reps: number | null
  fact_duration_min: string | null
  fact_duration_sec: number | null
  fact_distance_km: string | null
  fact_rpe: string | null
  confirmed_at: Date | null
  version: string
}

export interface PilotCustomExercise {
  id: string
  name: string
  muscleGroup: MuscleGroup
  inputKind: InputKind
  archivedAt: string | null
  version: number
}

export interface PilotWorkoutSet {
  id: string
  position: number
  plan: {
    weightKg: number | null
    reps: number | null
    durationMin: number | null
    durationSec: number | null
    distanceKm: number | null
    rpe: number | null
  }
  fact: {
    weightKg: number | null
    reps: number | null
    durationMin: number | null
    durationSec: number | null
    distanceKm: number | null
    rpe: number | null
  }
  confirmedAt: string | null
  version: number
}

export interface PilotWorkoutExercise {
  id: string
  position: number
  source: ExerciseSource
  ref: string
  customExerciseId: string | null
  name: string
  muscleGroup: MuscleGroup
  inputKind: InputKind
  blockId: string
  blockType: BlockType
  blockPreset: BlockPreset
  blockRounds: number
  restBetweenExercisesSec: number
  restBetweenRoundsSec: number
  restBetweenSetsSec: number
  trainerComment: string | null
  sets: PilotWorkoutSet[]
}

export interface PilotWorkout {
  id: string
  trainerId: string
  clientId: string
  clientName: string
  createdBy: string | null
  workoutDate: string
  startTime: string | null
  endTime: string | null
  status: WorkoutStatus
  notes: string | null
  startedAt: string | null
  completedAt: string | null
  version: number
  exercises: PilotWorkoutExercise[]
}

export interface PilotTrainingDataResponse {
  accessMode: 'read_only'
  customExercises: PilotCustomExercise[]
  workouts: PilotWorkout[]
  hasMoreWorkouts: boolean
}

function safeInteger(value: string, field: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} must be a safe integer`)
  return parsed
}

function optionalNumber(value: string | null): number | null {
  return value === null ? null : Number(value)
}

export async function readAccessibleTrainingData(
  client: DatabaseClient,
): Promise<PilotTrainingDataResponse> {
  const [customExerciseRows, workoutLookahead] = await Promise.all([
    client.query<CustomExerciseRow>(`
      select id, name, muscle_group, input_kind, archived_at, version
      from public.custom_exercises
      order by archived_at nulls first, lower(name), id
    `),
    client.query<WorkoutRow>(`
      select
        workout.id,
        workout.trainer_id,
        workout.client_id,
        client.full_name as client_name,
        workout.created_by,
        workout.workout_date::text as workout_date,
        workout.start_time,
        workout.end_time,
        workout.status,
        workout.notes,
        workout.started_at,
        workout.completed_at,
        workout.version
      from public.workouts workout
      join public.clients client on client.id = workout.client_id
      where workout.deleted_at is null
      order by workout.workout_date desc, workout.start_time desc nulls last,
        workout.created_at desc, workout.id
      limit $1
    `, [WORKOUT_PAGE_SIZE + 1]),
  ])
  const workoutRows = workoutLookahead.slice(0, WORKOUT_PAGE_SIZE)
  const workoutIds = workoutRows.map((row) => row.id)
  const exerciseRows = workoutIds.length === 0
    ? []
    : await client.query<WorkoutExerciseRow>(`
        select
          id, workout_id, position, exercise_source, exercise_ref,
          custom_exercise_id, exercise_name, muscle_group, input_kind,
          block_id, block_type, block_preset, block_rounds,
          rest_between_exercises_sec, rest_between_rounds_sec,
          rest_between_sets_sec, trainer_comment
        from public.workout_exercises
        where workout_id = any($1::uuid[])
        order by workout_id, position, id
      `, [workoutIds])
  const exerciseIds = exerciseRows.map((row) => row.id)
  const setRows = exerciseIds.length === 0
    ? []
    : await client.query<WorkoutSetRow>(`
        select
          id, workout_exercise_id, position,
          plan_weight_kg, plan_reps, plan_duration_min, plan_duration_sec,
          plan_distance_km, plan_rpe,
          fact_weight_kg, fact_reps, fact_duration_min, fact_duration_sec,
          fact_distance_km, fact_rpe, confirmed_at, version
        from public.workout_sets
        where workout_exercise_id = any($1::uuid[])
        order by workout_exercise_id, position, id
      `, [exerciseIds])

  const setsByExercise = new Map<string, PilotWorkoutSet[]>()
  for (const row of setRows) {
    const current = setsByExercise.get(row.workout_exercise_id) ?? []
    current.push({
      id: row.id,
      position: row.position,
      plan: {
        weightKg: optionalNumber(row.plan_weight_kg),
        reps: row.plan_reps,
        durationMin: optionalNumber(row.plan_duration_min),
        durationSec: row.plan_duration_sec,
        distanceKm: optionalNumber(row.plan_distance_km),
        rpe: optionalNumber(row.plan_rpe),
      },
      fact: {
        weightKg: optionalNumber(row.fact_weight_kg),
        reps: row.fact_reps,
        durationMin: optionalNumber(row.fact_duration_min),
        durationSec: row.fact_duration_sec,
        distanceKm: optionalNumber(row.fact_distance_km),
        rpe: optionalNumber(row.fact_rpe),
      },
      confirmedAt: row.confirmed_at?.toISOString() ?? null,
      version: safeInteger(row.version, 'workout set version'),
    })
    setsByExercise.set(row.workout_exercise_id, current)
  }

  const exercisesByWorkout = new Map<string, PilotWorkoutExercise[]>()
  for (const row of exerciseRows) {
    const current = exercisesByWorkout.get(row.workout_id) ?? []
    current.push({
      id: row.id,
      position: row.position,
      source: row.exercise_source,
      ref: row.exercise_ref,
      customExerciseId: row.custom_exercise_id,
      name: row.exercise_name,
      muscleGroup: row.muscle_group,
      inputKind: row.input_kind,
      blockId: row.block_id,
      blockType: row.block_type,
      blockPreset: row.block_preset,
      blockRounds: row.block_rounds,
      restBetweenExercisesSec: row.rest_between_exercises_sec,
      restBetweenRoundsSec: row.rest_between_rounds_sec,
      restBetweenSetsSec: row.rest_between_sets_sec,
      trainerComment: row.trainer_comment,
      sets: setsByExercise.get(row.id) ?? [],
    })
    exercisesByWorkout.set(row.workout_id, current)
  }

  return {
    accessMode: 'read_only',
    customExercises: customExerciseRows.map((row) => ({
      id: row.id,
      name: row.name,
      muscleGroup: row.muscle_group,
      inputKind: row.input_kind,
      archivedAt: row.archived_at?.toISOString() ?? null,
      version: safeInteger(row.version, 'custom exercise version'),
    })),
    workouts: workoutRows.map((row) => ({
      id: row.id,
      trainerId: row.trainer_id,
      clientId: row.client_id,
      clientName: row.client_name,
      createdBy: row.created_by,
      workoutDate: row.workout_date,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      notes: row.notes,
      startedAt: row.started_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null,
      version: safeInteger(row.version, 'workout version'),
      exercises: exercisesByWorkout.get(row.id) ?? [],
    })),
    hasMoreWorkouts: workoutLookahead.length > WORKOUT_PAGE_SIZE,
  }
}
