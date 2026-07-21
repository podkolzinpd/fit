// schema-sha256: 2f14e1f338f78a9ee340fa7791df96af712cde065591729e1f65eff5e1a2fc08
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type ProfileRow = { id: string; first_name: string | null; last_name: string | null; timezone: string; created_at: string; updated_at: string }
type TrainerRow = { profile_id: string; created_at: string; updated_at: string }
type ClientRow = { id: string; trainer_id: string; auth_user_id: string | null; full_name: string; gender: string; age_years: number; age_updated_at: string; height_cm: number; goal: string | null; archived_at: string | null; version: number; created_at: string; updated_at: string }
type PrivateRow = { client_id: string; trainer_id: string; note: string | null; created_at: string; updated_at: string }
type CustomExerciseRow = { id: string; trainer_id: string; name: string; muscle_group: string; input_kind: string; archived_at: string | null; version: number; created_at: string; updated_at: string }
type WorkoutRow = { id: string; trainer_id: string; client_id: string; workout_date: string; start_time: string | null; end_time: string | null; status: string; notes: string | null; started_at: string | null; completed_at: string | null; deleted_at: string | null; version: number; created_at: string; updated_at: string }
type WorkoutExerciseRow = { id: string; workout_id: string; trainer_id: string; client_id: string; position: number; exercise_source: string; exercise_ref: string; custom_exercise_id: string | null; exercise_name: string; muscle_group: string; input_kind: string; created_at: string; updated_at: string }
type WorkoutSetRow = { id: string; workout_exercise_id: string; trainer_id: string; client_id: string; position: number; plan_weight_kg: number | null; plan_reps: number | null; plan_duration_min: number | null; plan_distance_km: number | null; fact_weight_kg: number | null; fact_reps: number | null; fact_duration_min: number | null; fact_distance_km: number | null; confirmed_at: string | null; version: number; created_at: string; updated_at: string }
type ProgressRow = { id: string; trainer_id: string; client_id: string; recorded_on: string; weight_kg: number | null; chest_cm: number | null; waist_cm: number | null; hip_cm: number | null; notes: string | null; deleted_at: string | null; version: number; created_at: string; updated_at: string }
type MetricRow = { id: string; trainer_id: string; client_id: string; name: string; unit: string | null; archived_at: string | null; version: number; created_at: string; updated_at: string }
type ProgressCustomRow = { id: string; trainer_id: string; client_id: string; progress_id: string; metric_id: string; value: number; created_at: string; updated_at: string }

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow, Pick<ProfileRow, 'id'> & Partial<ProfileRow>>
      trainers: Table<TrainerRow, Pick<TrainerRow, 'profile_id'> & Partial<TrainerRow>>
      clients: Table<ClientRow, Pick<ClientRow, 'trainer_id' | 'full_name' | 'gender' | 'age_years' | 'height_cm'> & Partial<ClientRow>>
      client_private_details: Table<PrivateRow, Pick<PrivateRow, 'client_id' | 'trainer_id'> & Partial<PrivateRow>>
      custom_exercises: Table<CustomExerciseRow, Pick<CustomExerciseRow, 'trainer_id' | 'name' | 'muscle_group' | 'input_kind'> & Partial<CustomExerciseRow>>
      workouts: Table<WorkoutRow, Pick<WorkoutRow, 'trainer_id' | 'client_id' | 'workout_date'> & Partial<WorkoutRow>>
      workout_exercises: Table<WorkoutExerciseRow, Pick<WorkoutExerciseRow, 'workout_id' | 'trainer_id' | 'client_id' | 'position' | 'exercise_source' | 'exercise_ref' | 'exercise_name' | 'muscle_group' | 'input_kind'> & Partial<WorkoutExerciseRow>>
      workout_sets: Table<WorkoutSetRow, Pick<WorkoutSetRow, 'workout_exercise_id' | 'trainer_id' | 'client_id' | 'position'> & Partial<WorkoutSetRow>>
      client_progress: Table<ProgressRow, Pick<ProgressRow, 'trainer_id' | 'client_id' | 'recorded_on'> & Partial<ProgressRow>>
      client_custom_metrics: Table<MetricRow, Pick<MetricRow, 'trainer_id' | 'client_id' | 'name'> & Partial<MetricRow>>
      client_progress_custom: Table<ProgressCustomRow, Pick<ProgressCustomRow, 'trainer_id' | 'client_id' | 'progress_id' | 'metric_id' | 'value'> & Partial<ProgressCustomRow>>
    }
    Views: Record<string, never>
    Functions: {
      initialize_trainer: { Args: { p_first_name?: string | null; p_last_name?: string | null; p_timezone?: string }; Returns: TrainerRow }
      create_client: { Args: { p_client: Json }; Returns: string }
      update_client: { Args: { p_client: Json; p_expected_version: number }; Returns: number }
      save_workout: { Args: { p_workout: Json; p_expected_version?: number | null }; Returns: string }
      start_workout: { Args: { p_workout_id: string; p_expected_version: number }; Returns: number }
      save_live_set_draft: { Args: { p_set_id: string; p_draft: Json; p_expected_version: number }; Returns: number }
      confirm_live_set: { Args: { p_set_id: string; p_expected_version: number }; Returns: number }
      finish_workout: { Args: { p_workout_id: string; p_expected_version: number }; Returns: number }
      save_progress: { Args: { p_progress: Json; p_expected_version?: number | null }; Returns: string }
      soft_delete_workout: { Args: { p_workout_id: string; p_expected_version: number }; Returns: undefined }
      soft_delete_progress: { Args: { p_progress_id: string; p_expected_version: number }; Returns: undefined }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
