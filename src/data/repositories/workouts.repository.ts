import type { ExerciseSnapshot, InputKind, LiveSetDraft, MuscleGroup, Workout, WorkoutDraft, WorkoutExercise, WorkoutSet, WorkoutStatus, WorkoutSummary } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import type { WorkoutListRow } from '../database.types'
import { clientsRepository } from './clients.repository'
import { collectPages, pageFromLookahead } from './collect-pages'
import { repositoryError } from './error'
import { workoutQueries } from '../queries/workouts.queries'
export { canTransition, copyWorkout, computeClientStats, exerciseChartPoints, chartUnitFor, splitClientWorkouts, workoutDurationLabel } from './workout-rules'
export type { ExerciseChartPoint } from './workout-rules'

async function get(id: string): Promise<Workout> {
  const [root, exercises] = await Promise.all([workoutQueries.getRoot(id), workoutQueries.getExercises(id)])
  if (root.error) throw repositoryError(root.error)
  if (exercises.error) throw repositoryError(exercises.error)
  const sets = exercises.data.length ? await workoutQueries.getSets(exercises.data.map((item) => item.id)) : { data: [], error: null }
  if (sets.error) throw repositoryError(sets.error)
  const grouped = new Map<string, WorkoutSet[]>()
  for (const row of sets.data) {
    const current = grouped.get(row.workout_exercise_id) ?? []
    current.push({
      id: row.id, position: row.position,
      weightKg: row.plan_weight_kg ?? undefined, reps: row.plan_reps ?? undefined,
      durationMin: row.plan_duration_min ?? undefined, distanceKm: row.plan_distance_km ?? undefined,
      fact: { weightKg: row.fact_weight_kg ?? undefined, reps: row.fact_reps ?? undefined,
        durationMin: row.fact_duration_min ?? undefined, distanceKm: row.fact_distance_km ?? undefined },
      confirmedAt: row.confirmed_at, version: row.version,
    })
    grouped.set(row.workout_exercise_id, current)
  }
  const mappedExercises: WorkoutExercise[] = exercises.data.map((row) => ({
    id: row.id, position: row.position, source: row.exercise_source as 'system' | 'custom', ref: row.exercise_ref,
    customExerciseId: row.custom_exercise_id ?? undefined, name: row.exercise_name,
    muscleGroup: row.muscle_group as MuscleGroup, inputKind: row.input_kind as InputKind,
    sets: grouped.get(row.id) ?? [],
  }))
  const client = await clientsRepository.get(root.data.client_id)
  return {
    id: root.data.id, clientId: root.data.client_id, clientName: client.fullName,
    workoutDate: localDate(root.data.workout_date), startTime: root.data.start_time,
    endTime: root.data.end_time, startedAt: root.data.started_at ?? null, completedAt: root.data.completed_at ?? null,
    status: root.data.status as Workout['status'], notes: root.data.notes,
    version: root.data.version, exercises: mappedExercises,
  }
}

function mapWorkout(row: WorkoutListRow): Workout {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    workoutDate: localDate(row.workout_date),
    startTime: row.start_time,
    endTime: row.end_time,
    // The list RPC doesn't carry timer timestamps; only the detail view (get)
    // needs them for the duration label.
    startedAt: null,
    completedAt: null,
    status: row.status as WorkoutStatus,
    notes: row.notes,
    version: row.version,
    exercises: row.exercises.map((exercise) => ({
      id: exercise.id,
      position: exercise.position,
      source: exercise.exercise_source as 'system' | 'custom',
      ref: exercise.exercise_ref,
      customExerciseId: exercise.custom_exercise_id ?? undefined,
      name: exercise.exercise_name,
      muscleGroup: exercise.muscle_group as MuscleGroup,
      inputKind: exercise.input_kind as InputKind,
      sets: exercise.sets.map((set) => ({
        id: set.id,
        position: set.position,
        weightKg: set.plan_weight_kg ?? undefined,
        reps: set.plan_reps ?? undefined,
        durationMin: set.plan_duration_min ?? undefined,
        distanceKm: set.plan_distance_km ?? undefined,
        fact: {
          weightKg: set.fact_weight_kg ?? undefined,
          reps: set.fact_reps ?? undefined,
          durationMin: set.fact_duration_min ?? undefined,
          distanceKm: set.fact_distance_km ?? undefined,
        },
        confirmedAt: set.confirmed_at,
        version: set.version,
      })),
    })),
  }
}

async function listPage(from?: string, to?: string, clientId?: string, offset = 0, pageSize = 50) {
  const result = await workoutQueries.listPage(from, to, clientId, pageSize + 1, offset)
  if (result.error) throw repositoryError(result.error)
  return {
    ...pageFromLookahead(result.data.map(mapWorkout), pageSize, offset),
    totalCount: Number(result.data[0]?.total_count ?? 0),
  }
}

export const workoutsRepository = {
  get,
  listPage,
  async list(from?: string, to?: string, clientId?: string): Promise<Workout[]> {
    return collectPages((offset) => listPage(from, to, clientId, offset))
  },
  async listSummaries(clientId: string): Promise<WorkoutSummary[]> {
    const result = await workoutQueries.listSummaries(clientId)
    if (result.error) throw repositoryError(result.error)
    return result.data.map((row) => ({
      id: row.id, workoutDate: localDate(row.workout_date), status: row.status as WorkoutStatus,
    }))
  },
  async save(draft: WorkoutDraft): Promise<string> {
    const result = await workoutQueries.save(draft)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async start(workout: Workout): Promise<number> {
    const result = await workoutQueries.start(workout.id, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async saveLiveSet(id: string, draft: LiveSetDraft, version: number): Promise<number> {
    const result = await workoutQueries.saveLiveSet(id, draft, version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async confirmLiveSet(id: string, version: number): Promise<number> {
    const result = await workoutQueries.confirmLiveSet(id, version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async appendLiveExercise(workout: Workout, exercise: ExerciseSnapshot): Promise<number> {
    const result = await workoutQueries.appendLiveExercise(workout.id, exercise, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async appendLiveSet(workout: Workout, exerciseId: string): Promise<number> {
    const result = await workoutQueries.appendLiveSet(exerciseId, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async finish(workout: Workout): Promise<number> {
    const result = await workoutQueries.finish(workout.id, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async remove(workout: Workout): Promise<void> {
    const result = await workoutQueries.remove(workout.id, workout.version)
    if (result.error) throw repositoryError(result.error)
  },
}
