// schema-sha256: 604738e0de1d53b2c864ba9120f99ed432421bfa607d01d3042e409015525894
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type ProfileRow = { id: string; account_role: 'trainer' | 'client'; first_name: string | null; last_name: string | null; timezone: string; created_at: string; updated_at: string }
type TrainerRow = { profile_id: string; created_at: string; updated_at: string }
type ClientRow = { id: string; trainer_id: string; auth_user_id: string | null; full_name: string; gender: string; age_years: number; age_updated_at: string; height_cm: number; goal: string | null; archived_at: string | null; version: number; created_at: string; updated_at: string }
type PrivateRow = { client_id: string; trainer_id: string; note: string | null; created_at: string; updated_at: string }
type CustomExerciseRow = { id: string; trainer_id: string; name: string; muscle_group: string; input_kind: string; archived_at: string | null; version: number; created_at: string; updated_at: string }
type WorkoutRow = { id: string; trainer_id: string; client_id: string; created_by: string | null; workout_date: string; start_time: string | null; end_time: string | null; status: string; notes: string | null; started_at: string | null; completed_at: string | null; deleted_at: string | null; version: number; created_at: string; updated_at: string }
type WorkoutExerciseRow = { id: string; workout_id: string; trainer_id: string; client_id: string; position: number; exercise_source: string; exercise_ref: string; custom_exercise_id: string | null; exercise_name: string; muscle_group: string; input_kind: string; block_id: string; block_type: string; block_preset: string; block_rounds: number; rest_between_exercises_sec: number; rest_between_rounds_sec: number; rest_between_sets_sec: number; trainer_comment: string | null; created_at: string; updated_at: string }
type WorkoutSetRow = { id: string; workout_exercise_id: string; trainer_id: string; client_id: string; position: number; plan_weight_kg: number | null; plan_reps: number | null; plan_duration_min: number | null; plan_distance_km: number | null; fact_weight_kg: number | null; fact_reps: number | null; fact_duration_min: number | null; fact_distance_km: number | null; confirmed_at: string | null; version: number; created_at: string; updated_at: string }
type ProgressRow = { id: string; trainer_id: string; client_id: string; created_by: string | null; recorded_on: string; weight_kg: number | null; chest_cm: number | null; waist_cm: number | null; hip_cm: number | null; notes: string | null; deleted_at: string | null; version: number; created_at: string; updated_at: string }
type MetricRow = { id: string; trainer_id: string; client_id: string; name: string; unit: string | null; archived_at: string | null; version: number; created_at: string; updated_at: string }
type ProgressCustomRow = { id: string; trainer_id: string; client_id: string; progress_id: string; metric_id: string; value: number; created_at: string; updated_at: string }
type ClientTrainerRow = { client_id: string; trainer_id: string; joined_at: string }
type ClientInvitationRow = { id: string; client_id: string; created_by: string; target_role: string; code_hash: string; expires_at: string; claimed_by: string | null; claimed_at: string | null; revoked_at: string | null; created_at: string }
type ClientListRow = { id: string; full_name: string; gender: string; age_years: number; age_updated_at: string; height_cm: number; goal: string | null; note: string | null; current_weight_kg: number | null; archived_at: string | null; version: number }
type MyClientRow = Omit<ClientListRow, 'note'>
type WorkoutListSetRow = Pick<WorkoutSetRow, 'id' | 'position' | 'plan_weight_kg' | 'plan_reps' | 'plan_duration_min' | 'plan_distance_km' | 'fact_weight_kg' | 'fact_reps' | 'fact_duration_min' | 'fact_distance_km' | 'confirmed_at' | 'version'>
type WorkoutListExerciseRow = Pick<WorkoutExerciseRow, 'id' | 'position' | 'exercise_source' | 'exercise_ref' | 'custom_exercise_id' | 'exercise_name' | 'muscle_group' | 'input_kind' | 'block_id' | 'block_type' | 'block_preset' | 'block_rounds' | 'rest_between_exercises_sec' | 'rest_between_rounds_sec' | 'rest_between_sets_sec' | 'trainer_comment'> & { sets: WorkoutListSetRow[] }
export type WorkoutListRow = Pick<WorkoutRow, 'id' | 'client_id' | 'workout_date' | 'start_time' | 'end_time' | 'started_at' | 'completed_at' | 'status' | 'notes' | 'version'> & { client_name: string; total_count: number; exercises: WorkoutListExerciseRow[] }
type WorkoutSummaryRow = Pick<WorkoutRow, 'id' | 'workout_date' | 'status'>
type TrainerMembershipRow = { trainer_id: string; first_name: string | null; last_name: string | null; joined_at: string; is_root: boolean }

type TrainingSummaryRow = {
  id: string
  client_id: string
  trainer_id: string
  period_start: string
  period_end: string
  trainer_summary: Json
  client_summary: Json
  display_metrics: Json
  generated_at: string
  version: number
}
type PublishedTrainingSummaryRow = {
  id: string
  source_summary_id: string
  client_id: string
  trainer_id: string
  period_start: string
  period_end: string
  summary: Json
  display_metrics: Json
  generated_at: string
  published_at: string
}

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
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
      client_trainers: Table<ClientTrainerRow, Pick<ClientTrainerRow, 'client_id' | 'trainer_id'> & Partial<ClientTrainerRow>>
      client_invitations: Table<ClientInvitationRow, Pick<ClientInvitationRow, 'client_id' | 'created_by' | 'target_role' | 'code_hash' | 'expires_at'> & Partial<ClientInvitationRow>>
      client_training_summaries: Table<TrainingSummaryRow>
      client_published_training_summaries: Table<PublishedTrainingSummaryRow>
    }
    Views: Record<string, never>
    Functions: {
      initialize_account: { Args: { p_role: string; p_first_name?: string | null; p_last_name?: string | null; p_timezone?: string }; Returns: ProfileRow }
      initialize_trainer: { Args: { p_first_name?: string | null; p_last_name?: string | null; p_timezone?: string }; Returns: TrainerRow }
      get_my_client: { Args: Record<string, never>; Returns: MyClientRow[] }
      can_access_client: { Args: { p_client_id: string }; Returns: boolean }
      can_read_workout: { Args: { p_workout_id: string }; Returns: boolean }
      create_client_invitation: { Args: { p_client_id: string; p_target_role: string }; Returns: string }
      claim_client_invitation: { Args: { p_code: string }; Returns: string }
      revoke_client_invitation: { Args: { p_invitation_id: string }; Returns: undefined }
      remove_client_trainer: { Args: { p_client_id: string; p_trainer_id: string }; Returns: undefined }
      leave_client_space: { Args: { p_client_id: string }; Returns: undefined }
      list_client_trainers: { Args: { p_client_id: string }; Returns: TrainerMembershipRow[] }
      list_clients: { Args: { p_include_archived?: boolean }; Returns: ClientListRow[] }
      list_workouts: { Args: { p_from?: string | null; p_to?: string | null; p_client_id?: string | null; p_limit?: number; p_offset?: number }; Returns: WorkoutListRow[] }
      list_workout_summaries: { Args: { p_client_id: string }; Returns: WorkoutSummaryRow[] }
      create_client: { Args: { p_client: Json }; Returns: string }
      create_own_client: { Args: { p_client: Json }; Returns: string }
      update_client: { Args: { p_client: Json; p_expected_version: number }; Returns: number }
      save_workout: { Args: { p_workout: Json; p_expected_version?: number | null }; Returns: string }
      start_workout: { Args: { p_workout_id: string; p_expected_version: number }; Returns: number }
      save_live_set_draft: { Args: { p_set_id: string; p_draft: Json; p_expected_version: number }; Returns: number }
      confirm_live_set: { Args: { p_set_id: string; p_expected_version: number }; Returns: number }
      append_live_exercise: { Args: { p_workout_id: string; p_exercise: Json; p_expected_version: number }; Returns: number }
      append_live_set: { Args: { p_workout_exercise_id: string; p_expected_version: number }; Returns: number }
      remove_live_set: { Args: { p_set_id: string; p_expected_version: number }; Returns: number }
      set_exercise_comment: { Args: { p_exercise_id: string; p_comment: string; p_expected_version: number }; Returns: number }
      reorder_live_block: { Args: { p_workout_id: string; p_block_id: string; p_direction: number; p_expected_version: number }; Returns: number }
      replace_live_exercise: { Args: { p_workout_id: string; p_exercise_id: string; p_exercise: Json; p_expected_version: number }; Returns: number }
      finish_workout: { Args: { p_workout_id: string; p_expected_version: number }; Returns: number }
      save_progress: { Args: { p_progress: Json; p_expected_version?: number | null }; Returns: string }
      soft_delete_workout: { Args: { p_workout_id: string; p_expected_version: number }; Returns: undefined }
      soft_delete_progress: { Args: { p_progress_id: string; p_expected_version: number }; Returns: undefined }
      publish_training_summary: { Args: { p_summary_id: string; p_client_summary: Json; p_expected_version: number }; Returns: number[] }
      unpublish_training_summary: { Args: { p_summary_id: string; p_expected_version: number }; Returns: number }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
