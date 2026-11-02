import type { ExerciseSnapshot } from '../../shared/domain'
import type { WorkoutParseResponse } from '../../shared/workout-parse-response'
import { parseWorkout } from '../queries/workout-ai.queries'
import { repositoryError } from './error'

export async function parseWorkoutForSession(text: string, catalog: readonly ExerciseSnapshot[]): Promise<WorkoutParseResponse> {
  const result = await parseWorkout(text, catalog)
  if (result.error || !result.data) throw repositoryError(result.error ?? new Error('Пустой ответ парсера'))
  return result.data
}
