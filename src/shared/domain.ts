import type { LocalDate } from './local-date'

export type UUID = string
export type WorkoutStatus = 'planned' | 'in_progress' | 'done'
export type Gender = 'male' | 'female'
export type MuscleGroup = 'legs' | 'chest' | 'back' | 'shoulders' | 'arms' | 'core' | 'cardio' | 'other'
export type InputKind = 'strength' | 'distance' | 'reps'
// Тип блока упражнений внутри тренировки: одиночное, суперсет, трисет, круговая.
export type BlockType = 'single' | 'superset' | 'triset' | 'circuit'

export interface SessionActor {
  userId: UUID
  email: string | null
  firstName: string | null
  lastName: string | null
  timezone: string
}

export interface Client {
  id: UUID
  fullName: string
  gender: Gender
  ageYears: number
  ageUpdatedAt: LocalDate
  heightCm: number
  goal: string | null
  note: string | null
  currentWeightKg: number | null
  archivedAt: string | null
  version: number
}

export interface CreateClientInput {
  fullName: string
  gender: Gender
  ageYears: number
  ageUpdatedAt: LocalDate
  heightCm: number
  goal?: string
  note?: string
  initialWeightKg?: number
  initialWeightRecordedOn?: LocalDate
}

export interface UpdateClientInput extends Omit<CreateClientInput, 'initialWeightKg' | 'initialWeightRecordedOn'> {
  id: UUID
  version: number
}

export interface ExerciseSnapshot {
  source: 'system' | 'custom'
  ref: string
  customExerciseId?: UUID
  name: string
  muscleGroup: MuscleGroup
  inputKind: InputKind
  // Метаданные каталога для отображения (не сохраняются с тренировкой):
  // оборудование, детальные мышцы, картинка, уровень.
  equipment?: string
  equipmentRef?: string
  primaryMuscleDetail?: string
  secondaryMuscles?: string[]
  level?: string | null
  imageUrl?: string
  instructions?: string[]
}

export interface WorkoutSetDraft {
  position: number
  weightKg?: number
  reps?: number
  durationMin?: number
  distanceKm?: number
}

export interface WorkoutExerciseDraft extends ExerciseSnapshot {
  position: number
  blockId?: UUID
  blockType?: BlockType
  blockRounds?: number
  trainerComment?: string
  sets: WorkoutSetDraft[]
}

export interface WorkoutDraft {
  id?: UUID
  clientId: UUID
  workoutDate: LocalDate
  startTime?: string
  endTime?: string
  notes?: string
  exercises: WorkoutExerciseDraft[]
  version?: number
}

export interface LiveSetDraft {
  weightKg?: number
  reps?: number
  durationMin?: number
  distanceKm?: number
}

export interface WorkoutSet extends WorkoutSetDraft {
  id: UUID
  fact: LiveSetDraft
  confirmedAt: string | null
  version: number
}

export interface WorkoutExercise extends ExerciseSnapshot {
  id: UUID
  position: number
  blockId: UUID
  blockType: BlockType
  blockRounds: number
  trainerComment?: string
  sets: WorkoutSet[]
}

export interface Workout {
  id: UUID
  clientId: UUID
  clientName: string
  workoutDate: LocalDate
  startTime: string | null
  endTime: string | null
  startedAt: string | null
  completedAt: string | null
  status: WorkoutStatus
  notes: string | null
  version: number
  exercises: WorkoutExercise[]
}

export interface WorkoutSummary {
  id: UUID
  workoutDate: LocalDate
  status: WorkoutStatus
}

export interface ClientStats {
  doneCount: number
  completionPercent: number | null
  lastWorkoutDate: LocalDate | null
  daysInWork: number | null
  needsAttention: boolean
}

export interface CustomMetric {
  id: UUID
  clientId: UUID
  name: string
  unit: string | null
  archivedAt: string | null
  version: number
}

export interface ProgressDraft {
  id?: UUID
  clientId: UUID
  recordedOn: LocalDate
  weightKg?: number
  chestCm?: number
  waistCm?: number
  hipCm?: number
  notes?: string
  customMetrics: Array<{ metricId: UUID; value: number }>
  version?: number
}

export interface ProgressEntry extends ProgressDraft {
  id: UUID
  version: number
}
