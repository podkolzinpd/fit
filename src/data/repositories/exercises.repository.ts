import type { ExerciseSnapshot, InputKind, MuscleGroup } from '../../shared/domain'
import { SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'
import { exerciseQueries } from '../queries/exercises.queries'
import { repositoryError } from './error'

export interface CustomExercise extends ExerciseSnapshot { id: string; archivedAt: string | null; version: number }

function map(row: { id: string; name: string; muscle_group: string; input_kind: string; archived_at: string | null; version: number }): CustomExercise {
  return { id: row.id, source: 'custom', ref: row.id, customExerciseId: row.id, name: row.name,
    muscleGroup: row.muscle_group as MuscleGroup, inputKind: row.input_kind as InputKind,
    archivedAt: row.archived_at, version: row.version }
}

export const exercisesRepository = {
  system: SYSTEM_EXERCISE_CATALOG,
  async list(): Promise<CustomExercise[]> {
    const result = await exerciseQueries.list()
    if (result.error) throw repositoryError(result.error)
    return result.data.map(map)
  },
  async create(trainerId: string, value: { name: string; muscleGroup: MuscleGroup; inputKind: InputKind }) {
    const result = await exerciseQueries.create(trainerId, { name: value.name, muscle_group: value.muscleGroup, input_kind: value.inputKind })
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
