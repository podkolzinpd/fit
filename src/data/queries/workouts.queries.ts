import type { ExerciseSnapshot, LiveSetDraft, WorkoutDraft } from '../../shared/domain'
import { supabase } from './client'
import { toJson } from './json'

const rootColumns = 'id,client_id,created_by,workout_date,start_time,end_time,started_at,completed_at,status,notes,version'

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
  getRoot: (id: string) => supabase.from('workouts').select(rootColumns).eq('id', id).is('deleted_at', null).single(),
  getExercises: (id: string) => supabase.from('workout_exercises')
    .select('id,position,exercise_source,exercise_ref,custom_exercise_id,exercise_name,muscle_group,input_kind,block_id,block_type,block_preset,block_rounds,rest_between_exercises_sec,rest_between_rounds_sec,rest_between_sets_sec,trainer_comment')
    .eq('workout_id', id).order('position'),
  getSets: (exerciseIds: string[]) => supabase.from('workout_sets')
    .select('id,workout_exercise_id,position,plan_weight_kg,plan_reps,plan_duration_min,plan_distance_km,fact_weight_kg,fact_reps,fact_duration_min,fact_distance_km,confirmed_at,version')
    .in('workout_exercise_id', exerciseIds).order('position'),
  save: (draft: WorkoutDraft) => supabase.rpc('save_workout', {
    p_workout: toJson(draft), p_expected_version: draft.version ?? null,
  }),
  start: (id: string, version: number) => supabase.rpc('start_workout', { p_workout_id: id, p_expected_version: version }),
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
  replaceLiveExercise: (workoutId: string, exerciseId: string, exercise: ExerciseSnapshot, version: number) => supabase.rpc('replace_live_exercise', {
    p_workout_id: workoutId, p_exercise_id: exerciseId, p_exercise: toJson(exercise), p_expected_version: version,
  }),
  finish: (id: string, version: number) => supabase.rpc('finish_workout', { p_workout_id: id, p_expected_version: version }),
  remove: (id: string, version: number) => supabase.rpc('soft_delete_workout', { p_workout_id: id, p_expected_version: version }),
}
