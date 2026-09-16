import type { CustomMetric, ExerciseSnapshot, InputKind, MuscleGroup } from '../../shared/domain'
import { blobFromDataUrl, type PreparedImage } from '../../shared/image-prep'
import { SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'
import { customExerciseMedia, exerciseQueries, type WorkoutParseResponse } from '../queries/exercises.queries'
import { repositoryError } from './error'
import { validateGoalCriteriaSuggestion, type GoalCriteriaSuggestionResult } from '../../shared/goal-criteria-suggestions'

export type { WorkoutParseResponse } from '../queries/exercises.queries'

export interface CustomExercise extends ExerciseSnapshot { id: string; createdBy: string; archivedAt: string | null; version: number; imagePath: string | null }

export interface CustomExerciseDraft {
  name: string
  muscleGroup: MuscleGroup
  inputKind: InputKind
  primaryMuscleDetail?: string
  equipment?: string
  description?: string
}

type CustomExerciseRow = {
  id: string; name: string; muscle_group: string; input_kind: string; created_by: string
  archived_at: string | null; version: number
  primary_muscle_detail: string | null; equipment: string | null; description: string | null
  image_path: string | null
}

function map(row: CustomExerciseRow): CustomExercise {
  return { id: row.id, source: 'custom', ref: row.id, customExerciseId: row.id, name: row.name,
    muscleGroup: row.muscle_group as MuscleGroup, inputKind: row.input_kind as InputKind,
    primaryMuscleDetail: row.primary_muscle_detail ?? undefined,
    equipment: row.equipment ?? undefined,
    description: row.description ?? undefined,
    createdBy: row.created_by, archivedAt: row.archived_at, version: row.version, imagePath: row.image_path }
}

export const exercisesRepository = {
  system: SYSTEM_EXERCISE_CATALOG,
  async createVitalMediaUrl(path: string, expiresIn: number) {
    const result = await exerciseQueries.createVitalMediaUrl(path, expiresIn)
    if (result.error || !result.data?.signedUrl) throw repositoryError(result.error ?? new Error('Пустой адрес медиа'))
    return result.data.signedUrl
  },
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
  async create(partitionOwnerId: string, actorId: string, value: CustomExerciseDraft, photo?: PreparedImage | null) {
    const id = photo ? crypto.randomUUID() : undefined
    const imagePath = photo && id ? `${actorId}/${id}.jpg` : null
    if (photo && imagePath) {
      const uploaded = await customExerciseMedia.upload(imagePath, blobFromDataUrl(photo.dataUrl), { contentType: photo.mimeType, upsert: false })
      if (uploaded.error) throw repositoryError(uploaded.error)
    }
    const result = await exerciseQueries.create(partitionOwnerId, {
      id,
      name: value.name,
      muscle_group: value.muscleGroup,
      input_kind: value.inputKind,
      primary_muscle_detail: value.primaryMuscleDetail ?? null,
      equipment: value.equipment ?? null,
      description: value.description ?? null,
      image_path: imagePath,
      image_mime_type: photo?.mimeType ?? null,
      image_width: photo?.width ?? null,
      image_height: photo?.height ?? null,
      image_size_bytes: photo?.sizeBytes ?? null,
    })
    if (result.error) throw repositoryError(result.error)
    return map(result.data)
  },
  async update(exercise: CustomExercise, value: CustomExerciseDraft) {
    const result = await exerciseQueries.update(exercise.id, exercise.version, {
      name: value.name,
      muscle_group: value.muscleGroup,
      input_kind: value.inputKind,
      primary_muscle_detail: value.primaryMuscleDetail ?? null,
      equipment: value.equipment ?? null,
      description: value.description ?? null,
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
