import type { InputKind, LiveSetDraft, MuscleGroup, Workout, WorkoutDraft, WorkoutExercise, WorkoutSet } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { clientsRepository } from './clients.repository'
import { repositoryError } from './error'
import { workoutQueries } from '../queries/workouts.queries'
export { canTransition, copyWorkout } from './workout-rules'

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
    endTime: root.data.end_time, status: root.data.status as Workout['status'], notes: root.data.notes,
    version: root.data.version, exercises: mappedExercises,
  }
}

export const workoutsRepository = {
  get,
  async list(from?: string, to?: string, clientId?: string): Promise<Workout[]> {
    const result = await workoutQueries.list(from, to, clientId)
    if (result.error) throw repositoryError(result.error)
    return Promise.all(result.data.map((row) => get(row.id)))
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
