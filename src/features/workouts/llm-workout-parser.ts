import type { ExerciseSnapshot } from '../../shared/domain'
import { exercisesRepository } from '../../data/repositories/exercises.repository'

export async function parseWorkoutWithLlm(text: string, catalog: readonly ExerciseSnapshot[]) {
  return exercisesRepository.parseWorkout(text, catalog)
}
