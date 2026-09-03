import type { CustomMetric, ExerciseSnapshot, InputKind, MuscleGroup } from '../../shared/domain'
import { SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'
import { exerciseQueries, type WorkoutParseResponse } from '../queries/exercises.queries'
import { repositoryError } from './error'
import { validateGoalCriteriaSuggestion, type GoalCriteriaSuggestionResult } from '../../shared/goal-criteria-suggestions'

export type { WorkoutParseResponse } from '../queries/exercises.queries'

export interface CustomExercise extends ExerciseSnapshot { id: string; createdBy: string; archivedAt: string | null; version: number }

function map(row: { id: string; name: string; muscle_group: string; input_kind: string; created_by: string; archived_at: string | null; version: number }): CustomExercise {
  return { id: row.id, source: 'custom', ref: row.id, customExerciseId: row.id, name: row.name,
    muscleGroup: row.muscle_group as MuscleGroup, inputKind: row.input_kind as InputKind,
    createdBy: row.created_by, archivedAt: row.archived_at, version: row.version }
}

export const exercisesRepository = {
  system: SYSTEM_EXERCISE_CATALOG,
  async parseWorkout(text: string, systemCatalog: readonly ExerciseSnapshot[]): Promise<WorkoutParseResponse> {
    const result = await exerciseQueries.parseWorkout(text, systemCatalog)
    if (result.error || !result.data) throw repositoryError(result.error ?? new Error('Пустой ответ парсера'))
    return result.data
  },
  async suggestGoalCriteria(text: string, catalog: readonly ExerciseSnapshot[], metrics: readonly CustomMetric[]): Promise<GoalCriteriaSuggestionResult> {
    const result = await exerciseQueries.suggestGoalCriteria(text, catalog, metrics)
    if (result.error || !result.data) throw repositoryError(result.error ?? new Error('Пустой ответ модели'))
    return validateGoalCriteriaSuggestion(result.data, catalog, metrics)
  },
  async list(): Promise<CustomExercise[]> {
    const result = await exerciseQueries.list()
    if (result.error) throw repositoryError(result.error)
    return result.data.map(map)
  },
  async create(partitionOwnerId: string, value: { name: string; muscleGroup: MuscleGroup; inputKind: InputKind }) {
    const result = await exerciseQueries.create(partitionOwnerId, { name: value.name, muscle_group: value.muscleGroup, input_kind: value.inputKind })
    if (result.error) throw repositoryError(result.error)
    return map(result.data)
  },
  async update(exercise: CustomExercise, value: { name: string; muscleGroup: MuscleGroup; inputKind: InputKind }) {
    const result = await exerciseQueries.update(exercise.id, exercise.version, {
      name: value.name, muscle_group: value.muscleGroup, input_kind: value.inputKind,
    })
    if (result.error) throw repositoryError(result.error)
    return map(result.data)
  },
  async setArchived(exercise: CustomExercise, archived: boolean) {
    const result = await exerciseQueries.setArchived(exercise.id, exercise.version, archived)
    if (result.error) throw repositoryError(result.error)
    return map(result.data)
  },
}
