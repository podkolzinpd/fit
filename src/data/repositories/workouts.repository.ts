import type { BlockPreset, BlockType, ExerciseProgressCursor, ExerciseProgressPage, ExerciseSnapshot, InputKind, LiveSetDraft, MuscleGroup, TrainerAttentionWorkout, TrainerReaction, Workout, WorkoutDraft, WorkoutExercise, WorkoutFeedbackDraft, WorkoutPersonalRecord, WorkoutPersonalRecordMetric, WorkoutQuestionAnswerDraft, WorkoutSet, WorkoutSetDraft, WorkoutStatus, WorkoutSummary, WorkoutTrainerResponseDraft, WorkoutWellbeing } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import type { WorkoutListRow } from '../database.types'
import { clientsRepository } from './clients.repository'
import { collectPages, pageFromLookahead } from './collect-pages'
import { repositoryError } from './error'
import { workoutQueries } from '../queries/workouts.queries'
import { EXERCISE_PROGRESS_PAGE_SIZE, exerciseProgressPageFromRows } from './exercise-progress-page'
export { canTransition, copyWorkout, completedWorkoutDraft, computeClientStats, exerciseChartPoints, chartUnitFor, compactCompletedSetSummary, compactExerciseDetailSummary, compactPlannedSetOverview, compactPlannedSetSummary, durationLabel, durationSeconds, formatFactVsPlan, factLine, enteredFactLine, previousResultLine, splitClientWorkouts, clientWorkoutStatusLabel, workoutStatusPresentation, workoutDurationLabel, muscleGroupLabels, exerciseSummary, nextSetDraft, bmiValue, bmiLabel, workoutTonnage, tonnageLabel, groupIntoBlocks, isLastSetOfBlock, blockRoundsView, currentRoundIndex, blockLabel, BLOCK_PRESET_LABELS, PRESET_REST_DEFAULTS, DEFAULT_REST_BETWEEN_SETS, restSecondsAfterSet, applyRunningIntervalPreset, applyRunningActiveRecoveryPreset, createRunningFormatDrafts, ensureBlockIds, groupDraftsIntoBlocks, mergeBlockWithNext, splitBlock, setBlockPreset, setBlockRest, syncBlockRounds, draftBlockRoundsView, moveBlock, replaceExercise } from './workout-rules'
export type { ExerciseBlock, DraftBlock, DraftBlockRound, BlockRound, WorkoutStatusPresentation, WorkoutStatusTone } from './workout-rules'
export type { ExerciseChartPoint } from './workout-rules'

export interface PreviousExerciseResult {
  workoutDate: ReturnType<typeof localDate>
  sets: WorkoutSetDraft[]
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function previousSets(value: unknown): WorkoutSetDraft[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, position) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    return [{
      position,
      weightKg: numberOrUndefined(row.weightKg), reps: numberOrUndefined(row.reps),
      durationSec: numberOrUndefined(row.durationSec), distanceKm: numberOrUndefined(row.distanceKm),
      rpe: numberOrUndefined(row.rpe),
    }]
  })
}

async function get(id: string): Promise<Workout> {
  const [root, exercises] = await Promise.all([workoutQueries.getRoot(id), workoutQueries.getExercises(id)])
  if (root.error) throw repositoryError(root.error)
  if (exercises.error) throw repositoryError(exercises.error)
  const sets = exercises.data.length ? await workoutQueries.getSets(exercises.data.map((item) => item.id)) : { data: [], error: null }
  if (sets.error) throw repositoryError(sets.error)
  const grouped = new Map<string, WorkoutSet[]>()
  for (const row of sets.data) {
    const current = grouped.get(row.workout_exercise_id) ?? []
    current.push({
      id: row.id, position: row.position,
      weightKg: row.plan_weight_kg ?? undefined, reps: row.plan_reps ?? undefined,
      durationMin: row.plan_duration_min ?? undefined, durationSec: row.plan_duration_sec ?? undefined,
      distanceKm: row.plan_distance_km ?? undefined, rpe: row.plan_rpe ?? undefined,
      fact: { weightKg: row.fact_weight_kg ?? undefined, reps: row.fact_reps ?? undefined,
        durationMin: row.fact_duration_min ?? undefined, durationSec: row.fact_duration_sec ?? undefined,
        distanceKm: row.fact_distance_km ?? undefined, rpe: row.fact_rpe ?? undefined },
      confirmedAt: row.confirmed_at, version: row.version,
    })
    grouped.set(row.workout_exercise_id, current)
  }
  const mappedExercises: WorkoutExercise[] = exercises.data.map((row) => ({
    id: row.id, position: row.position, source: row.exercise_source as 'system' | 'custom', ref: row.exercise_ref,
    customExerciseId: row.custom_exercise_id ?? undefined, name: row.exercise_name,
    muscleGroup: row.muscle_group as MuscleGroup, inputKind: row.input_kind as InputKind,
    blockId: row.block_id, blockType: row.block_type as BlockType, blockPreset: row.block_preset as BlockPreset, blockRounds: row.block_rounds,
    restBetweenExercisesSec: row.rest_between_exercises_sec, restBetweenRoundsSec: row.rest_between_rounds_sec, restBetweenSetsSec: row.rest_between_sets_sec,
    trainerComment: row.trainer_comment ?? undefined,
    sets: grouped.get(row.id) ?? [],
  }))
  const client = await clientsRepository.get(root.data.client_id)
  return {
    id: root.data.id, trainerId: root.data.trainer_id, clientId: root.data.client_id, clientName: client.fullName, createdBy: root.data.created_by,
    workoutDate: localDate(root.data.workout_date), startTime: root.data.start_time,
    endTime: root.data.end_time, startedAt: root.data.started_at ?? null, completedAt: root.data.completed_at ?? null,
    status: root.data.status as Workout['status'], notes: root.data.notes,
    trainerReview: root.data.trainer_review ?? undefined,
    trainerReaction: root.data.trainer_reaction ? root.data.trainer_reaction as TrainerReaction : undefined,
    trainerReviewAuthorId: root.data.trainer_review_author_id ?? undefined,
    trainerReviewedAt: root.data.trainer_reviewed_at ?? undefined,
    clientComment: root.data.client_comment ?? undefined,
    sessionRpe: root.data.session_rpe ?? undefined,
    wellbeing: root.data.wellbeing ? root.data.wellbeing as WorkoutWellbeing : undefined,
    discomfort: root.data.discomfort ?? undefined,
    feedbackSubmittedAt: root.data.feedback_submitted_at ?? undefined,
    clientQuestion: root.data.client_question ?? undefined,
    clientQuestionAskedAt: root.data.client_question_asked_at ?? undefined,
    clientQuestionResolvedAt: root.data.client_question_resolved_at ?? undefined,
    stageId: root.data.stage_id ?? null, stageTitle: null,
    version: root.data.version, exercises: mappedExercises,
  }
}

function mapWorkout(row: WorkoutListRow): Workout {
  return {
    id: row.id,
    trainerId: row.trainer_id,
    clientId: row.client_id,
    clientName: row.client_name,
    createdBy: row.created_by,
    workoutDate: localDate(row.workout_date),
    startTime: row.start_time,
    endTime: row.end_time,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    status: row.status as WorkoutStatus,
    notes: row.notes,
    trainerReview: row.trainer_review ?? undefined,
    trainerReaction: row.trainer_reaction ? row.trainer_reaction as TrainerReaction : undefined,
    trainerReviewAuthorId: row.trainer_review_author_id ?? undefined,
    trainerReviewedAt: row.trainer_reviewed_at ?? undefined,
    clientComment: row.client_comment ?? undefined,
    sessionRpe: row.session_rpe ?? undefined,
    wellbeing: row.wellbeing ? row.wellbeing as WorkoutWellbeing : undefined,
    discomfort: row.discomfort ?? undefined,
    hasPr: row.has_pr,
    stageId: row.stage_id ?? null,
    stageTitle: row.stage_title ?? null,
    version: row.version,
    exercises: row.exercises.map((exercise) => ({
      id: exercise.id,
      position: exercise.position,
      source: exercise.exercise_source as 'system' | 'custom',
      ref: exercise.exercise_ref,
      customExerciseId: exercise.custom_exercise_id ?? undefined,
      name: exercise.exercise_name,
      muscleGroup: exercise.muscle_group as MuscleGroup,
      inputKind: exercise.input_kind as InputKind,
      blockId: exercise.block_id,
      blockType: exercise.block_type as BlockType,
      blockPreset: exercise.block_preset as BlockPreset,
      blockRounds: exercise.block_rounds,
      restBetweenExercisesSec: exercise.rest_between_exercises_sec,
      restBetweenRoundsSec: exercise.rest_between_rounds_sec,
      restBetweenSetsSec: exercise.rest_between_sets_sec,
      trainerComment: exercise.trainer_comment ?? undefined,
      sets: exercise.sets.map((set) => ({
        id: set.id,
        position: set.position,
        weightKg: set.plan_weight_kg ?? undefined,
        reps: set.plan_reps ?? undefined,
        durationMin: set.plan_duration_min ?? undefined,
        durationSec: set.plan_duration_sec ?? undefined,
        distanceKm: set.plan_distance_km ?? undefined,
        rpe: set.plan_rpe ?? undefined,
        fact: {
          weightKg: set.fact_weight_kg ?? undefined,
          reps: set.fact_reps ?? undefined,
          durationMin: set.fact_duration_min ?? undefined,
          durationSec: set.fact_duration_sec ?? undefined,
          distanceKm: set.fact_distance_km ?? undefined,
          rpe: set.fact_rpe ?? undefined,
        },
        confirmedAt: set.confirmed_at,
        version: set.version,
      })),
    })),
  }
}

async function listPage(from?: string, to?: string, clientId?: string, offset = 0, pageSize = 50) {
  const result = await workoutQueries.listPage(from, to, clientId, pageSize + 1, offset)
  if (result.error) throw repositoryError(result.error)
  return {
    ...pageFromLookahead(result.data.map(mapWorkout), pageSize, offset),
    totalCount: Number(result.data[0]?.total_count ?? 0),
  }
}

async function listSummaries(clientId: string): Promise<WorkoutSummary[]> {
  const result = await workoutQueries.listSummaries(clientId)
  if (result.error) throw repositoryError(result.error)
  return result.data.map((row) => ({
    id: row.id, workoutDate: localDate(row.workout_date), status: row.status as WorkoutStatus,
  }))
}

async function findActive(clientId: string): Promise<WorkoutSummary | null> {
  return (await listSummaries(clientId)).find((workout) => workout.status === 'in_progress') ?? null
}

export const workoutsRepository = {
  get,
  listPage,
  async list(from?: string, to?: string, clientId?: string): Promise<Workout[]> {
    return collectPages((offset) => listPage(from, to, clientId, offset))
  },
  listSummaries,
  findActive,
  async personalRecords(workoutId: string): Promise<WorkoutPersonalRecord[]> {
    const result = await workoutQueries.personalRecords(workoutId)
    if (result.error) throw repositoryError(result.error)
    return result.data.map((row) => ({
      exerciseRef: row.exercise_ref,
      exerciseName: row.exercise_name,
      inputKind: row.input_kind as InputKind,
      metric: row.metric as WorkoutPersonalRecordMetric,
      primaryValue: Number(row.primary_value),
      weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
      reps: row.reps,
    }))
  },
  async latestExerciseResults(clientId: string, exerciseRefs: string[]): Promise<Map<string, PreviousExerciseResult>> {
    if (!exerciseRefs.length) return new Map()
    const result = await workoutQueries.latestExerciseResults(clientId, exerciseRefs)
    if (result.error) throw repositoryError(result.error)
    return new Map(result.data.map((row) => [row.exercise_ref, {
      workoutDate: localDate(row.workout_date),
      sets: previousSets(row.sets),
    }]))
  },
  async exerciseProgressPage(
    clientId: string,
    exerciseRef: string,
    cursor: ExerciseProgressCursor | null,
  ): Promise<ExerciseProgressPage> {
    const result = await workoutQueries.exerciseProgress(
      clientId,
      exerciseRef,
      EXERCISE_PROGRESS_PAGE_SIZE + 1,
      cursor,
    )
    if (result.error) throw repositoryError(result.error)
    return exerciseProgressPageFromRows(result.data)
  },
  async save(draft: WorkoutDraft): Promise<string> {
    const result = await workoutQueries.save(draft)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async saveCompleted(draft: WorkoutDraft): Promise<string> {
    const result = await workoutQueries.saveCompleted(draft)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async start(workout: Workout): Promise<number> {
    const result = await workoutQueries.start(workout.id, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async cancelPlanned(workout: Workout): Promise<number> {
    const result = await workoutQueries.cancelPlanned(workout.id, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async reschedule(workout: Workout, workoutDate: ReturnType<typeof localDate>, startTime: string | null): Promise<number> {
    const result = await workoutQueries.reschedule(workout.id, workoutDate, startTime, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async saveLiveSet(id: string, draft: LiveSetDraft, version: number): Promise<number> {
    const result = await workoutQueries.saveLiveSet(id, draft, version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async confirmLiveSet(id: string, version: number): Promise<number> {
    const result = await workoutQueries.confirmLiveSet(id, version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async appendLiveExercise(workout: Workout, exercise: ExerciseSnapshot): Promise<number> {
    const result = await workoutQueries.appendLiveExercise(workout.id, exercise, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async appendLiveSet(workout: Workout, exerciseId: string): Promise<number> {
    const result = await workoutQueries.appendLiveSet(exerciseId, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async removeLiveSet(workout: Workout, setId: string): Promise<number> {
    const result = await workoutQueries.removeLiveSet(setId, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async reorderLiveBlock(workout: Workout, blockId: string, direction: -1 | 1): Promise<number> {
    const result = await workoutQueries.reorderLiveBlock(workout.id, blockId, direction, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async setExerciseComment(workout: Workout, exerciseId: string, comment: string): Promise<number> {
    const result = await workoutQueries.setExerciseComment(exerciseId, comment, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async setWorkoutReview(workout: Workout, response: WorkoutTrainerResponseDraft): Promise<number> {
    const result = await workoutQueries.setWorkoutReview(workout.id, response, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async setClientWorkoutComment(workout: Workout, comment: string): Promise<number> {
    const result = await workoutQueries.setClientWorkoutComment(workout.id, comment, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async submitFeedback(workout: Workout, feedback: WorkoutFeedbackDraft): Promise<number> {
    const result = await workoutQueries.submitFeedback(workout.id, feedback, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async askQuestion(workout: Workout, question: string): Promise<number> {
    const result = await workoutQueries.askQuestion(workout.id, question, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async answerQuestion(workout: Workout, response: WorkoutQuestionAnswerDraft): Promise<number> {
    const result = await workoutQueries.answerQuestion(workout.id, response, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async resolveQuestion(workout: Workout): Promise<number> {
    const result = await workoutQueries.resolveQuestion(workout.id, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async listTrainerAttention(): Promise<TrainerAttentionWorkout[]> {
    const result = await workoutQueries.listTrainerAttention()
    if (result.error) throw repositoryError(result.error)
    return result.data.map((row) => ({
      workoutId: row.workout_id,
      clientId: row.client_id,
      clientName: row.client_name,
      workoutDate: localDate(row.workout_date),
      clientQuestion: row.client_question ?? undefined,
      clientQuestionAskedAt: row.client_question_asked_at ?? undefined,
      discomfort: row.discomfort ?? false,
      clientComment: row.client_comment ?? undefined,
      feedbackSubmittedAt: row.feedback_submitted_at ?? undefined,
      version: row.version,
    }))
  },
  async snoozeClientAttention(clientId: string): Promise<string> {
    const result = await workoutQueries.snoozeClientAttention(clientId)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async replaceLiveExercise(workout: Workout, exerciseId: string, exercise: ExerciseSnapshot): Promise<number> {
    const result = await workoutQueries.replaceLiveExercise(workout.id, exerciseId, exercise, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async finish(workout: Workout): Promise<number> {
    const result = await workoutQueries.finish(workout.id, workout.version)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async remove(workout: Workout): Promise<void> {
    const result = await workoutQueries.remove(workout.id, workout.version)
    if (result.error) throw repositoryError(result.error)
  },
}
