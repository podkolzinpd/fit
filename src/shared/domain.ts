import type { LocalDate } from './local-date'

export type UUID = string
export type WorkoutStatus = 'planned' | 'in_progress' | 'done'
export type Gender = 'male' | 'female'
export type MuscleGroup = 'legs' | 'glutes' | 'chest' | 'back' | 'shoulders' | 'arms' | 'core' | 'cardio' | 'other'
export type InputKind = 'strength' | 'distance' | 'reps' | 'duration'
// Тип блока: одиночное упражнение или объединённая группа. Механика группы одна
// (упражнения по кругу); «Сет», «Круговая» и «Интервалы» — пресеты (блоки
// различаются названием и дефолтами отдыха).
export type BlockType = 'single' | 'group'
export type BlockPreset = 'set' | 'circuit' | 'interval'

export type AccountRole = 'trainer' | 'client'
export type TrainerReaction = 'thumbs_up' | 'fire' | 'strong'

interface SessionActorBase {
  userId: UUID
  role: AccountRole
  email: string | null
  firstName: string | null
  lastName: string | null
  timezone: string
}

export interface TrainerActor extends SessionActorBase {
  kind: 'trainer'
}

export interface ClientActor extends SessionActorBase {
  kind: 'client'
  clientId: UUID
  trainerId: UUID
  fullName: string
}

export type SessionActor = TrainerActor | ClientActor

export interface TrainerMembership {
  trainerId: UUID
  firstName: string | null
  lastName: string | null
  joinedAt: string
  isRoot: boolean
}

export interface ClientInvitation {
  id: UUID
  clientId: UUID
  targetRole: AccountRole
  expiresAt: string
  createdAt: string
}

export interface Client {
  id: UUID
  hasAccount: boolean | null
  fullName: string
  canonicalFullName: string
  gender: Gender | null
  ageYears: number | null
  ageUpdatedAt: LocalDate | null
  heightCm: number | null
  goal: string | null
  note: string | null
  currentWeightKg: number | null
  lastActivityAt?: string
  archivedAt: string | null
  version: number
  membershipVersion: number | null
}

export interface UpdateClientTrainerPreferencesInput {
  clientId: UUID
  alias: string
  note?: string
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

// Периодизация: цель клиента (одна активная) + этапы-подцели с датами.
export interface GoalStage {
  id: UUID
  goalId: UUID
  title: string
  startsOn: LocalDate
  endsOn: LocalDate
  position: number
  version: number
}

export interface ClientGoal {
  id: UUID
  clientId: UUID
  title: string
  targetDate: LocalDate | null
  status: 'active' | 'archived'
  version: number
  stages: GoalStage[]
}

export interface SaveClientGoalInput {
  clientId: UUID
  id?: UUID
  title: string
  targetDate?: LocalDate | null
  version?: number
}

export interface SaveGoalStageInput {
  goalId: UUID
  id?: UUID
  title: string
  startsOn: LocalDate
  endsOn: LocalDate
  position?: number
  version?: number
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

export type RunningProgressFormat =
  | 'free'
  | 'easy'
  | 'long'
  | 'tempo'
  | 'recovery'
  | 'interval'
  | 'interval_active'
  | 'mixed'

export interface RunningProgressSession {
  workoutId: UUID
  workoutDate: LocalDate
  format: RunningProgressFormat
  distanceKm?: number
  durationSec?: number
  paceSecPerKm?: number
  rpe?: number
}

export interface WorkoutSetDraft {
  /** Идентификатор строки исходной тренировки при правке завершённой записи. */
  sourceSetId?: UUID
  position: number
  weightKg?: number
  reps?: number
  /** Новые тренировки хранят длительность точно, в целых секундах. */
  durationSec?: number
  /** Совместимость с историческими тренировками, записанными до секунд. */
  durationMin?: number
  distanceKm?: number
  /** Целевая субъективная нагрузка в плане: 6–10, шаг 0,5. */
  rpe?: number
}

export interface WorkoutExerciseDraft extends ExerciseSnapshot {
  /** Идентификатор упражнения исходной тренировки при правке завершённой записи. */
  sourceExerciseId?: UUID
  /** При замене упражнения в завершённой записи факт не переносится на новое. */
  clearFact?: boolean
  position: number
  blockId?: UUID
  blockType?: BlockType
  blockPreset?: BlockPreset
  blockRounds?: number
  restBetweenExercisesSec?: number
  restBetweenRoundsSec?: number
  restBetweenSetsSec?: number
  trainerComment?: string
  /** Дата последнего завершённого выполнения, из которого подставлены значения. */
  prefilledFromDate?: LocalDate
  sets: WorkoutSetDraft[]
}

export interface WorkoutDraft {
  id?: UUID
  /** Стабильный ключ одного действия «Сохранить» для повтора после сбоя сети. */
  requestId?: UUID
  clientId: UUID
  workoutDate: LocalDate
  startTime?: string
  endTime?: string
  notes?: string
  stageId?: UUID | null
  exercises: WorkoutExerciseDraft[]
  version?: number
}

export interface LiveSetDraft {
  weightKg?: number
  reps?: number
  durationSec?: number
  durationMin?: number
  distanceKm?: number
  /** Фактическая субъективная нагрузка: 6–10, шаг 0,5. */
  rpe?: number
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
  blockPreset: BlockPreset
  blockRounds: number
  restBetweenExercisesSec: number
  restBetweenRoundsSec: number
  restBetweenSetsSec: number
  trainerComment?: string
  sets: WorkoutSet[]
}

export type WorkoutWellbeing = 'good' | 'normal' | 'hard'

export interface WorkoutFeedbackDraft {
  sessionRpe: number
  wellbeing: WorkoutWellbeing
  discomfort: boolean
  comment: string
}

export interface Workout {
  id: UUID
  clientId: UUID
  trainerId?: UUID
  clientName: string
  createdBy?: UUID | null
  workoutDate: LocalDate
  startTime: string | null
  endTime: string | null
  startedAt: string | null
  completedAt: string | null
  status: WorkoutStatus
  notes: string | null
  trainerReview?: string
  trainerReaction?: TrainerReaction
  trainerReviewAuthorId?: UUID
  trainerReviewedAt?: string
  clientComment?: string
  sessionRpe?: number
  wellbeing?: WorkoutWellbeing
  discomfort?: boolean
  hasPr?: boolean
  stageId: UUID | null
  stageTitle: string | null
  version: number
  exercises: WorkoutExercise[]
}

export interface WorkoutTrainerResponseDraft {
  reaction: TrainerReaction
  review: string
}

export interface WorkoutSummary {
  id: UUID
  workoutDate: LocalDate
  status: WorkoutStatus
}

export type WorkoutPersonalRecordMetric = 'primary' | 'weight' | 'weight_reps'

export interface WorkoutPersonalRecord {
  exerciseRef: string
  exerciseName: string
  inputKind: InputKind
  metric: WorkoutPersonalRecordMetric
  primaryValue: number
  weightKg: number | null
  reps: number | null
}

export interface ExerciseProgressSet {
  weightKg?: number
  reps?: number
  durationSec?: number
  distanceKm?: number
  rpe?: number
}

export interface ExerciseProgressResult {
  workoutId: UUID
  workoutDate: LocalDate
  completedAt: string
  exerciseName: string
  inputKind: InputKind
  confirmedSetCount: number
  primaryValue: number | null
  previousPrimaryValue: number | null
  primaryChange: number | null
  allTimePrimaryValue: number | null
  bestWeightKg: number | null
  repsAtBestWeight: number | null
  bestWeightReps: number | null
  allTimeBestWeightKg: number | null
  allTimeBestWeightReps: number | null
  isPrimaryPr: boolean
  isWeightPr: boolean
  isWeightRepsPr: boolean
  trainerComment: string | null
  sets: ExerciseProgressSet[]
}

export interface ExerciseProgressCursor {
  completedAt: string
  workoutId: UUID
}

export interface ExerciseProgressPage {
  items: ExerciseProgressResult[]
  nextCursor: ExerciseProgressCursor | null
  totalCount: number
}

export interface ClientStats {
  doneCount: number
  completionPercent: number | null
  lastWorkoutDate: LocalDate | null
  daysInWork: number | null
  needsAttention: boolean
}

export type WorkoutRegularityPeriod = 'week' | 'month'

export interface WorkoutRegularity {
  period: WorkoutRegularityPeriod
  periodStart: LocalDate
  periodEnd: LocalDate
  plannedCount: number
  completedCount: number
  completedPlannedCount: number
  partialCount: number
  skippedCount: number
  completionPercent: number | null
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
  createdBy: UUID | null
  version: number
}

export interface TrainerTrainingSummary {
  headline: string
  progress: string[]
  consistency: string
  attention: string[]
}

export interface ClientTrainingSummary {
  headline: string
  achievements: string[]
  consistency: string
  encouragement: string
  goalAlignment?: string
  nextSteps?: string[]
}

export interface TrainingSummaryMetrics {
  completedWorkouts: number
  workoutsPerWeek: number
  activeWeeks: number
  longestGapDays: number | null
}

export interface TrainingSummary {
  id: UUID
  clientId: UUID
  periodStart: LocalDate
  periodEnd: LocalDate
  trainer: TrainerTrainingSummary
  client: ClientTrainingSummary
  metrics: TrainingSummaryMetrics
  generatedAt: string
  version: number
  published: boolean
}

export interface PublishedTrainingSummary {
  id: UUID
  sourceSummaryId: UUID
  clientId: UUID
  periodStart: LocalDate
  periodEnd: LocalDate
  summary: ClientTrainingSummary
  metrics: TrainingSummaryMetrics
  generatedAt: string
  publishedAt: string
}
