import type { FavoriteWorkoutTemplate, WorkoutExerciseDraft } from '../../shared/domain'
import { getSupabaseClient } from '../queries/client'
import { toJson } from '../queries/json'
import { repositoryError } from './error'

export interface FavoriteWorkoutsRepository {
  list(): Promise<FavoriteWorkoutTemplate[]>
  save(title: string, exercises: WorkoutExerciseDraft[]): Promise<FavoriteWorkoutTemplate>
  remove(id: string): Promise<void>
}

export function parseFavoriteWorkout(value: unknown): FavoriteWorkoutTemplate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Некорректные данные избранной тренировки')
  }
  const favorite = value as Record<string, unknown>
  if (typeof favorite.id !== 'string' || typeof favorite.title !== 'string'
    || typeof favorite.createdAt !== 'string' || !Array.isArray(favorite.exercises)) {
    throw new Error('Некорректные данные избранной тренировки')
  }
  return {
    id: favorite.id,
    title: favorite.title,
    createdAt: favorite.createdAt,
    exercises: favorite.exercises as WorkoutExerciseDraft[],
  }
}

export const favoriteWorkoutsRepository: FavoriteWorkoutsRepository = {
  async list() {
    const result = await getSupabaseClient().rpc('list_favorite_workouts')
    if (result.error) throw repositoryError(result.error)
    return Array.isArray(result.data) ? result.data.map(parseFavoriteWorkout) : []
  },
  async save(title, exercises) {
    const result = await getSupabaseClient().rpc('save_favorite_workout', { p_title: title, p_exercises: toJson(exercises) })
    if (result.error) throw repositoryError(result.error)
    return parseFavoriteWorkout(result.data)
  },
  async remove(id) {
    const result = await getSupabaseClient().rpc('delete_favorite_workout', { p_id: id })
    if (result.error) throw repositoryError(result.error)
  },
}
