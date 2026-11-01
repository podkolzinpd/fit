import type { FavoriteWorkoutTemplate, WorkoutExerciseDraft } from '../../shared/domain'

export interface FavoriteWorkoutsRepository {
  list(): Promise<FavoriteWorkoutTemplate[]>
  save(title: string, exercises: WorkoutExerciseDraft[]): Promise<FavoriteWorkoutTemplate>
  update(id: string, expectedVersion: number, title: string, exercises?: WorkoutExerciseDraft[]): Promise<FavoriteWorkoutTemplate>
  remove(id: string): Promise<void>
}
