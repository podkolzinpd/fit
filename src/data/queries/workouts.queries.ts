import type { ExerciseProgressCursor, ExerciseSnapshot, LiveSetDraft, WorkoutDraft, WorkoutFeedbackDraft, WorkoutQuestionAnswerDraft, WorkoutTrainerResponseDraft } from '../../shared/domain'
import { supabase } from './client'
import { toJson } from './json'

const rootColumns = 'id,trainer_id,client_id,created_by,workout_date,start_time,end_time,started_at,completed_at,status,notes,trainer_review,trainer_reaction,trainer_review_author_id,trainer_reviewed_at,client_comment,session_rpe,wellbeing,discomfort,feedback_submitted_at,client_question,client_question_asked_at,client_question_resolved_at,version,stage_id'

export type { WorkoutListRow } from '../database.types'

export const workoutQueries = {
  listPage: (from: string | undefined, to: string | undefined, clientId: string | undefined, limit: number, offset: number) =>
    supabase.rpc('list_workouts', {
      p_from: from ?? null,
      p_to: to ?? null,
      p_client_id: clientId ?? null,
      p_limit: limit,
      p_offset: offset,
    }),
  listSummaries: (clientId: string) => supabase.rpc('list_workout_summaries', { p_client_id: clientId }),
  latestExerciseResults: (clientId: string, exerciseRefs: string[]) => supabase.rpc('list_latest_exercise_results', {
    p_client_id: clientId, p_exercise_refs: exerciseRefs,
  }),
  exerciseProgress: (clientId: string, exerciseRef: string, limit: number, cursor: ExerciseProgressCursor | null) =>
    supabase.rpc('list_exercise_progress', {
      p_client_id: clientId,
      p_exercise_ref: exerciseRef,
      p_limit: limit,
      p_before_completed_at: cursor?.completedAt ?? null,
      p_before_workout_id: cursor?.workoutId ?? null,
    }),
  personalRecords: (workoutId: string) => supabase.rpc('list_workout_personal_records', {
    p_workout_id: workoutId,
  }),
  getRoot: (id: string) => supabase.from('workouts').select(rootColumns).eq('id', id).is('deleted_at', null).single(),
  getExercises: (id: string) => supabase.from('workout_exercises')
    .select('id,position,exercise_source,exercise_ref,custom_exercise_id,exercise_name,muscle_group,input_kind,block_id,block_type,block_preset,block_rounds,rest_between_exercises_sec,rest_between_rounds_sec,rest_between_sets_sec,trainer_comment')
    .eq('workout_id', id).order('position'),
  getSets: (exerciseIds: string[]) => supabase.from('workout_sets')
    .select('id,workout_exercise_id,position,plan_weight_kg,plan_reps,plan_duration_min,plan_duration_sec,plan_distance_km,plan_rpe,fact_weight_kg,fact_reps,fact_duration_min,fact_duration_sec,fact_distance_km,fact_rpe,confirmed_at,version')
    .in('workout_exercise_id', exerciseIds).order('position'),
  save: (draft: WorkoutDraft) => supabase.rpc('save_workout', {
    p_workout: toJson(draft), p_expected_version: draft.version ?? null,
  }),
  saveCompleted: (draft: WorkoutDraft) => supabase.rpc('save_completed_workout', {
    p_workout: toJson(draft), p_expected_version: draft.version ?? null,
  }),
  start: (id: string, version: number) => supabase.rpc('start_workout', { p_workout_id: id, p_expected_version: version }),
  cancelPlanned: (id: string, version: number) => supabase.rpc('cancel_planned_workout', {
    p_workout_id: id, p_expected_version: version,
  }),
  reschedule: (id: string, workoutDate: string, startTime: string | null, version: number) => supabase.rpc('reschedule_workout', {
    p_workout_id: id, p_workout_date: workoutDate, p_start_time: startTime, p_expected_version: version,
  }),
  saveLiveSet: (id: string, draft: LiveSetDraft, version: number) => supabase.rpc('save_live_set_draft', {
    p_set_id: id, p_draft: toJson(draft), p_expected_version: version,
  }),
  confirmLiveSet: (id: string, version: number) => supabase.rpc('confirm_live_set', { p_set_id: id, p_expected_version: version }),
  appendLiveExercise: (id: string, exercise: ExerciseSnapshot, version: number) => supabase.rpc('append_live_exercise', {
    p_workout_id: id, p_exercise: toJson(exercise), p_expected_version: version,
  }),
  appendLiveSet: (exerciseId: string, version: number) => supabase.rpc('append_live_set', {
    p_workout_exercise_id: exerciseId, p_expected_version: version,
  }),
  removeLiveSet: (setId: string, version: number) => supabase.rpc('remove_live_set', {
    p_set_id: setId, p_expected_version: version,
  }),
  reorderLiveBlock: (workoutId: string, blockId: string, direction: -1 | 1, version: number) => supabase.rpc('reorder_live_block', {
    p_workout_id: workoutId, p_block_id: blockId, p_direction: direction, p_expected_version: version,
  }),
  setExerciseComment: (exerciseId: string, comment: string, version: number) => supabase.rpc('set_exercise_comment', {
    p_exercise_id: exerciseId, p_comment: comment, p_expected_version: version,
  }),
  setWorkoutReview: (workoutId: string, response: WorkoutTrainerResponseDraft, version: number) => supabase.rpc('set_workout_review', {
    p_workout_id: workoutId, p_reaction: response.reaction, p_review: response.review, p_expected_version: version,
  }),
  setClientWorkoutComment: (workoutId: string, comment: string, version: number) => supabase.rpc('set_client_workout_comment', {
    p_workout_id: workoutId, p_comment: comment, p_expected_version: version,
  }),
  submitFeedback: (workoutId: string, feedback: WorkoutFeedbackDraft, version: number) => supabase.rpc('submit_workout_feedback', {
    p_workout_id: workoutId,
    p_session_rpe: feedback.sessionRpe,
    p_wellbeing: feedback.wellbeing,
    p_discomfort: feedback.discomfort,
    p_comment: feedback.comment,
    p_expected_version: version,
  }),
  askQuestion: (workoutId: string, question: string, version: number) => supabase.rpc('ask_workout_question', {
    p_workout_id: workoutId, p_question: question, p_expected_version: version,
  }),
  answerQuestion: (workoutId: string, response: WorkoutQuestionAnswerDraft, version: number) => supabase.rpc('answer_workout_question', {
    p_workout_id: workoutId, p_reaction: response.reaction ?? null, p_review: response.review, p_expected_version: version,
  }),
  resolveQuestion: (workoutId: string, version: number) => supabase.rpc('resolve_workout_question', {
    p_workout_id: workoutId, p_expected_version: version,
  }),
  listTrainerAttention: () => supabase.rpc('list_trainer_attention_workouts'),
  snoozeClientAttention: (clientId: string) => supabase.rpc('snooze_client_attention', { p_client_id: clientId }),
  replaceLiveExercise: (workoutId: string, exerciseId: string, exercise: ExerciseSnapshot, version: number) => supabase.rpc('replace_live_exercise', {
    p_workout_id: workoutId, p_exercise_id: exerciseId, p_exercise: toJson(exercise), p_expected_version: version,
  }),
  finish: (id: string, version: number) => supabase.rpc('finish_workout', { p_workout_id: id, p_expected_version: version }),
  remove: (id: string, version: number) => supabase.rpc('soft_delete_workout', { p_workout_id: id, p_expected_version: version }),
}
