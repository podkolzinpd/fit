import type { ExerciseSnapshot, InputKind, MuscleGroup } from '../../shared/domain'

export interface CustomExercise extends ExerciseSnapshot { id: string; createdBy: string; archivedAt: string | null; version: number; imagePath: string | null }

export interface CustomExerciseDraft {
  name: string
  muscleGroup: MuscleGroup
  inputKind: InputKind
  primaryMuscleDetail?: string
  equipment?: string
  description?: string
}
