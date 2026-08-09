// schema-sha256: ead76b2da030f264503f30b95ceb01c9b62cef76f1d40417d2426f943f33062d

/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type WorkoutListSetRow = {
  id: string; position: number; plan_weight_kg: number | null; plan_reps: number | null
  plan_duration_min: number | null; plan_duration_sec: number | null; plan_distance_km: number | null; plan_rpe: number | null
  fact_weight_kg: number | null; fact_reps: number | null; fact_duration_min: number | null; fact_duration_sec: number | null; fact_distance_km: number | null; fact_rpe: number | null
  confirmed_at: string | null; version: number
}
type WorkoutListExerciseRow = {
  id: string; position: number; exercise_source: string; exercise_ref: string; custom_exercise_id: string | null; exercise_name: string
  muscle_group: string; input_kind: string; block_id: string; block_type: string; block_preset: string; block_rounds: number
  rest_between_exercises_sec: number; rest_between_rounds_sec: number; rest_between_sets_sec: number; trainer_comment: string | null
  sets: WorkoutListSetRow[]
}
export type WorkoutListRow = {
  id: string; client_id: string; client_name: string; created_by: string | null; workout_date: string; start_time: string | null; end_time: string | null
  started_at: string | null; completed_at: string | null; status: string; notes: string | null; trainer_review: string | null; client_comment: string | null; stage_id: string | null; stage_title: string | null
  version: number; total_count: number; exercises: WorkoutListExerciseRow[]
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
      client_custom_metrics: {
        Row: {
          archived_at: string | null
          client_id: string
          created_at: string
          id: string
          name: string
          trainer_id: string
          unit: string | null
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          client_id: string
          created_at?: string
          id?: string
          name: string
          trainer_id: string
          unit?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          client_id?: string
          created_at?: string
          id?: string
          name?: string
          trainer_id?: string
          unit?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_metrics_client_fk"
            columns: ["client_id", "trainer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "trainer_id"]
          },
        ]
      }
      client_goals: {
        Row: {
          archived_at: string | null
          client_id: string
          created_at: string
          created_by: string
          id: string
          status: string
          target_date: string | null
          title: string
          trainer_id: string
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          client_id: string
          created_at?: string
          created_by: string
          id?: string
          status?: string
          target_date?: string | null
          title: string
          trainer_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          status?: string
          target_date?: string | null
          title?: string
          trainer_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_goals_client_fk"
            columns: ["client_id", "trainer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "trainer_id"]
          },
        ]
      }
      client_invitations: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          client_id: string
          code_hash: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          revoked_at: string | null
          target_role: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          client_id: string
          code_hash: string
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          revoked_at?: string | null
          target_role: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          client_id?: string
          code_hash?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          target_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_invitations_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invitations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_private_details: {
        Row: {
          client_id: string
          created_at: string
          note: string | null
          trainer_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          note?: string | null
          trainer_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          note?: string | null
          trainer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_private_client_fk"
            columns: ["client_id", "trainer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "trainer_id"]
          },
        ]
      }
      client_progress: {
        Row: {
          chest_cm: number | null
          client_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          hip_cm: number | null
          id: string
          notes: string | null
          recorded_on: string
          trainer_id: string
          updated_at: string
          version: number
          waist_cm: number | null
          weight_kg: number | null
        }
        Insert: {
          chest_cm?: number | null
          client_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          hip_cm?: number | null
          id?: string
          notes?: string | null
          recorded_on: string
          trainer_id: string
          updated_at?: string
          version?: number
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Update: {
          chest_cm?: number | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          hip_cm?: number | null
          id?: string
          notes?: string | null
          recorded_on?: string
          trainer_id?: string
          updated_at?: string
          version?: number
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_progress_client_fk"
            columns: ["client_id", "trainer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "trainer_id"]
          },
          {
            foreignKeyName: "client_progress_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_progress_custom: {
        Row: {
          client_id: string
          created_at: string
          id: string
          metric_id: string
          progress_id: string
          trainer_id: string
          updated_at: string
          value: number
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          metric_id: string
          progress_id: string
          trainer_id: string
          updated_at?: string
          value: number
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          metric_id?: string
          progress_id?: string
          trainer_id?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "progress_custom_metric_fk"
            columns: ["metric_id", "trainer_id", "client_id"]
            isOneToOne: false
            referencedRelation: "client_custom_metrics"
            referencedColumns: ["id", "trainer_id", "client_id"]
          },
          {
            foreignKeyName: "progress_custom_progress_fk"
            columns: ["progress_id", "trainer_id", "client_id"]
            isOneToOne: false
            referencedRelation: "client_progress"
            referencedColumns: ["id", "trainer_id", "client_id"]
          },
        ]
      }
      client_published_training_summaries: {
        Row: {
          client_id: string
          created_at: string
          display_metrics: Json
          generated_at: string
          id: string
          period_end: string
          period_start: string
          published_at: string
          published_by: string | null
          source_summary_id: string
          summary: Json
          trainer_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          display_metrics?: Json
          generated_at: string
          id?: string
          period_end: string
          period_start: string
          published_at?: string
          published_by?: string | null
          source_summary_id: string
          summary: Json
          trainer_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          display_metrics?: Json
          generated_at?: string
          id?: string
          period_end?: string
          period_start?: string
          published_at?: string
          published_by?: string | null
          source_summary_id?: string
          summary?: Json
          trainer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_published_training_summaries_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_published_training_summaries_source_summary_id_fkey"
            columns: ["source_summary_id"]
            isOneToOne: true
            referencedRelation: "client_training_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_training_summaries_client_fk"
            columns: ["client_id", "trainer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "trainer_id"]
          },
        ]
      }
      client_trainers: {
        Row: {
          alias: string | null
          client_id: string
          joined_at: string
          note: string | null
          trainer_id: string
          version: number
        }
        Insert: {
          alias?: string | null
          client_id: string
          joined_at?: string
          note?: string | null
          trainer_id: string
          version?: number
        }
        Update: {
          alias?: string | null
          client_id?: string
          joined_at?: string
          note?: string | null
          trainer_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_trainers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_trainers_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      client_training_summaries: {
        Row: {
          client_id: string
          client_summary: Json
          created_at: string
          display_metrics: Json
          generated_at: string
          id: string
          input_fingerprint: string
          input_stats: Json
          model_uri: string
          period_end: string
          period_start: string
          prompt_version: string
          summary: string
          token_usage: Json | null
          trainer_id: string
          trainer_summary: Json
          updated_at: string
          version: number
        }
        Insert: {
          client_id: string
          client_summary: Json
          created_at?: string
          display_metrics?: Json
          generated_at?: string
          id?: string
          input_fingerprint: string
          input_stats?: Json
          model_uri: string
          period_end: string
          period_start: string
          prompt_version: string
          summary: string
          token_usage?: Json | null
          trainer_id: string
          trainer_summary: Json
          updated_at?: string
          version?: number
        }
        Update: {
          client_id?: string
          client_summary?: Json
          created_at?: string
          display_metrics?: Json
          generated_at?: string
          id?: string
          input_fingerprint?: string
          input_stats?: Json
          model_uri?: string
          period_end?: string
          period_start?: string
          prompt_version?: string
          summary?: string
          token_usage?: Json | null
          trainer_id?: string
          trainer_summary?: Json
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_training_summaries_client_fk"
            columns: ["client_id", "trainer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "trainer_id"]
          },
        ]
      }
      clients: {
        Row: {
          age_updated_at: string | null
          age_years: number | null
          archived_at: string | null
          auth_user_id: string | null
          created_at: string
          full_name: string
          gender: string | null
          goal: string | null
          height_cm: number | null
          id: string
          trainer_id: string
          updated_at: string
          version: number
        }
        Insert: {
          age_updated_at?: string | null
          age_years?: number | null
          archived_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          full_name: string
          gender?: string | null
          goal?: string | null
          height_cm?: number | null
          id?: string
          trainer_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          age_updated_at?: string | null
          age_years?: number | null
          archived_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          full_name?: string
          gender?: string | null
          goal?: string | null
          height_cm?: number | null
          id?: string
          trainer_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "clients_partition_owner_fk"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_exercises: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          input_kind: string
          muscle_group: string
          name: string
          trainer_id: string
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          input_kind: string
          muscle_group: string
          name: string
          trainer_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          input_kind?: string
          muscle_group?: string
          name?: string
          trainer_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "custom_exercises_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      goal_stages: {
        Row: {
          client_id: string
          created_at: string
          ends_on: string
          goal_id: string
          id: string
          position: number
          starts_on: string
          title: string
          trainer_id: string
          updated_at: string
          version: number
        }
        Insert: {
          client_id: string
          created_at?: string
          ends_on: string
          goal_id: string
          id?: string
          position?: number
          starts_on: string
          title: string
          trainer_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          ends_on?: string
          goal_id?: string
          id?: string
          position?: number
          starts_on?: string
          title?: string
          trainer_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "goal_stages_goal_fk"
            columns: ["goal_id", "trainer_id", "client_id"]
            isOneToOne: false
            referencedRelation: "client_goals"
            referencedColumns: ["id", "trainer_id", "client_id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_role: string
          created_at: string
          first_name: string | null
          id: string
          last_name: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          account_role?: string
          created_at?: string
          first_name?: string | null
          id: string
          last_name?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          account_role?: string
          created_at?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      trainers: {
        Row: {
          created_at: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_exercises: {
        Row: {
          block_id: string
          block_preset: string
          block_rounds: number
          block_type: string
          client_id: string
          created_at: string
          custom_exercise_id: string | null
          exercise_name: string
          exercise_ref: string
          exercise_source: string
          id: string
          input_kind: string
          muscle_group: string
          position: number
          rest_between_exercises_sec: number
          rest_between_rounds_sec: number
          rest_between_sets_sec: number
          trainer_comment: string | null
          trainer_id: string
          updated_at: string
          workout_id: string
        }
        Insert: {
          block_id?: string
          block_preset?: string
          block_rounds?: number
          block_type?: string
          client_id: string
          created_at?: string
          custom_exercise_id?: string | null
          exercise_name: string
          exercise_ref: string
          exercise_source: string
          id?: string
          input_kind: string
          muscle_group: string
          position: number
          rest_between_exercises_sec?: number
          rest_between_rounds_sec?: number
          rest_between_sets_sec?: number
          trainer_comment?: string | null
          trainer_id: string
          updated_at?: string
          workout_id: string
        }
        Update: {
          block_id?: string
          block_preset?: string
          block_rounds?: number
          block_type?: string
          client_id?: string
          created_at?: string
          custom_exercise_id?: string | null
          exercise_name?: string
          exercise_ref?: string
          exercise_source?: string
          id?: string
          input_kind?: string
          muscle_group?: string
          position?: number
          rest_between_exercises_sec?: number
          rest_between_rounds_sec?: number
          rest_between_sets_sec?: number
          trainer_comment?: string | null
          trainer_id?: string
          updated_at?: string
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_exercises_custom_fk"
            columns: ["custom_exercise_id", "trainer_id"]
            isOneToOne: false
            referencedRelation: "custom_exercises"
            referencedColumns: ["id", "trainer_id"]
          },
          {
            foreignKeyName: "workout_exercises_workout_fk"
            columns: ["workout_id", "trainer_id", "client_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id", "trainer_id", "client_id"]
          },
        ]
      }
      workout_sets: {
        Row: {
          client_id: string
          confirmed_at: string | null
          created_at: string
          fact_distance_km: number | null
          fact_duration_min: number | null
          fact_duration_sec: number | null
          fact_reps: number | null
          fact_rpe: number | null
          fact_weight_kg: number | null
          id: string
          plan_distance_km: number | null
          plan_duration_min: number | null
          plan_duration_sec: number | null
          plan_reps: number | null
          plan_rpe: number | null
          plan_weight_kg: number | null
          position: number
          trainer_id: string
          updated_at: string
          version: number
          workout_exercise_id: string
        }
        Insert: {
          client_id: string
          confirmed_at?: string | null
          created_at?: string
          fact_distance_km?: number | null
          fact_duration_min?: number | null
          fact_duration_sec?: number | null
          fact_reps?: number | null
          fact_rpe?: number | null
          fact_weight_kg?: number | null
          id?: string
          plan_distance_km?: number | null
          plan_duration_min?: number | null
          plan_duration_sec?: number | null
          plan_reps?: number | null
          plan_rpe?: number | null
          plan_weight_kg?: number | null
          position: number
          trainer_id: string
          updated_at?: string
          version?: number
          workout_exercise_id: string
        }
        Update: {
          client_id?: string
          confirmed_at?: string | null
          created_at?: string
          fact_distance_km?: number | null
          fact_duration_min?: number | null
          fact_duration_sec?: number | null
          fact_reps?: number | null
          fact_rpe?: number | null
          fact_weight_kg?: number | null
          id?: string
          plan_distance_km?: number | null
          plan_duration_min?: number | null
          plan_duration_sec?: number | null
          plan_reps?: number | null
          plan_rpe?: number | null
          plan_weight_kg?: number | null
          position?: number
          trainer_id?: string
          updated_at?: string
          version?: number
          workout_exercise_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_sets_exercise_fk"
            columns: ["workout_exercise_id", "trainer_id", "client_id"]
            isOneToOne: false
            referencedRelation: "workout_exercises"
            referencedColumns: ["id", "trainer_id", "client_id"]
          },
        ]
      }
      workouts: {
        Row: {
          client_comment: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          end_time: string | null
          id: string
          notes: string | null
          stage_id: string | null
          start_time: string | null
          started_at: string | null
          status: string
          trainer_id: string
          trainer_review: string | null
          updated_at: string
          version: number
          workout_date: string
        }
        Insert: {
          client_comment?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          end_time?: string | null
          id?: string
          notes?: string | null
          stage_id?: string | null
          start_time?: string | null
          started_at?: string | null
          status?: string
          trainer_id: string
          trainer_review?: string | null
          updated_at?: string
          version?: number
          workout_date: string
        }
        Update: {
          client_comment?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          end_time?: string | null
          id?: string
          notes?: string | null
          stage_id?: string | null
          start_time?: string | null
          started_at?: string | null
          status?: string
          trainer_id?: string
          trainer_review?: string | null
          updated_at?: string
          version?: number
          workout_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "workouts_client_fk"
            columns: ["client_id", "trainer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "trainer_id"]
          },
          {
            foreignKeyName: "workouts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workouts_stage_fk"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "goal_stages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      append_live_exercise: {
        Args: {
          p_exercise: Json
          p_expected_version: number
          p_workout_id: string
        }
        Returns: number
      }
      append_live_set: {
        Args: { p_expected_version: number; p_workout_exercise_id: string }
        Returns: number
      }
      archive_client_goal: {
        Args: { p_expected_version: number; p_goal_id: string }
        Returns: undefined
      }
      authorize_client_mutation: {
        Args: { p_allow_owner: boolean; p_client_id: string }
        Returns: string
      }
      authorize_workout_mutation: {
        Args: { p_client_can_execute: boolean; p_workout_id: string }
        Returns: string
      }
      can_access_client: { Args: { p_client_id: string }; Returns: boolean }
      can_read_workout: { Args: { p_workout_id: string }; Returns: boolean }
      claim_client_invitation: { Args: { p_code: string }; Returns: string }
      confirm_live_set: {
        Args: { p_expected_version: number; p_set_id: string }
        Returns: number
      }
      create_client: { Args: { p_client: Json }; Returns: string }
      create_client_invitation: {
        Args: { p_client_id: string; p_target_role: string }
        Returns: string
      }
      create_own_client: { Args: { p_client: Json }; Returns: string }
      create_quick_client: { Args: { p_full_name: string }; Returns: string }
      delete_goal_stage: { Args: { p_stage_id: string }; Returns: undefined }
      finish_workout: {
        Args: { p_expected_version: number; p_workout_id: string }
        Returns: number
      }
      get_client_goal: { Args: { p_client_id: string }; Returns: Json }
      get_my_client: {
        Args: never
        Returns: {
          age_updated_at: string
          age_years: number
          archived_at: string
          current_weight_kg: number
          full_name: string
          gender: string
          goal: string
          height_cm: number
          id: string
          version: number
        }[]
      }
      initialize_account: {
        Args: {
          p_first_name?: string | null
          p_last_name?: string | null
          p_role: string
          p_timezone?: string
        }
        Returns: {
          account_role: string
          created_at: string
          first_name: string | null
          id: string
          last_name: string | null
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      initialize_trainer: {
        Args: {
          p_first_name?: string
          p_last_name?: string
          p_timezone?: string
        }
        Returns: {
          created_at: string
          profile_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "trainers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_client_space: { Args: { p_client_id: string }; Returns: undefined }
      list_client_trainers: {
        Args: { p_client_id: string }
        Returns: {
          first_name: string
          is_root: boolean
          joined_at: string
          last_name: string
          trainer_id: string
        }[]
      }
      list_clients: {
        Args: { p_include_archived?: boolean }
        Returns: {
          age_updated_at: string
          age_years: number
          archived_at: string
          canonical_full_name: string
          current_weight_kg: number
          full_name: string
          gender: string
          goal: string
          has_account: boolean
          height_cm: number
          id: string
          last_activity_at: string
          membership_version: number
          note: string
          version: number
        }[]
      }
      list_latest_exercise_results: {
        Args: { p_client_id: string; p_exercise_refs: string[] }
        Returns: {
          exercise_ref: string
          sets: Json
          workout_date: string
        }[]
      }
      list_workout_summaries: {
        Args: { p_client_id: string }
        Returns: {
          id: string
          status: string
          workout_date: string
        }[]
      }
      list_workouts: {
        Args: {
          p_client_id?: string | null
          p_from?: string | null
          p_limit?: number
          p_offset?: number
          p_to?: string | null
        }
        Returns: WorkoutListRow[]
      }
      publish_training_summary: {
        Args: {
          p_client_summary: Json
          p_expected_version: number
          p_summary_id: string
        }
        Returns: {
          next_version: number
          published_id: string
        }[]
      }
      remove_client_trainer: {
        Args: { p_client_id: string; p_trainer_id: string }
        Returns: undefined
      }
      remove_live_set: {
        Args: { p_expected_version: number; p_set_id: string }
        Returns: number
      }
      reorder_live_block: {
        Args: {
          p_block_id: string
          p_direction: number
          p_expected_version: number
          p_workout_id: string
        }
        Returns: number
      }
      replace_live_exercise: {
        Args: {
          p_exercise: Json
          p_exercise_id: string
          p_expected_version: number
          p_workout_id: string
        }
        Returns: number
      }
      revoke_client_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      save_client_goal: {
        Args: { p_expected_version?: number; p_goal: Json }
        Returns: string
      }
      save_completed_workout: {
        Args: { p_expected_version?: number | null; p_workout: Json }
        Returns: string
      }
      save_goal_stage: {
        Args: { p_expected_version?: number; p_stage: Json }
        Returns: string
      }
      save_live_set_draft: {
        Args: { p_draft: Json; p_expected_version: number; p_set_id: string }
        Returns: number
      }
      save_progress: {
        Args: { p_expected_version?: number | null; p_progress: Json }
        Returns: string
      }
      save_workout: {
        Args: { p_expected_version?: number | null; p_workout: Json }
        Returns: string
      }
      set_client_workout_comment: {
        Args: {
          p_comment: string
          p_expected_version: number
          p_workout_id: string
        }
        Returns: number
      }
      set_exercise_comment: {
        Args: {
          p_comment: string
          p_exercise_id: string
          p_expected_version: number
        }
        Returns: number
      }
      set_workout_review: {
        Args: {
          p_expected_version: number
          p_review: string
          p_workout_id: string
        }
        Returns: number
      }
      soft_delete_progress: {
        Args: { p_expected_version: number; p_progress_id: string }
        Returns: undefined
      }
      soft_delete_workout: {
        Args: { p_expected_version: number; p_workout_id: string }
        Returns: undefined
      }
      start_workout: {
        Args: { p_expected_version: number; p_workout_id: string }
        Returns: number
      }
      unpublish_training_summary: {
        Args: { p_expected_version: number; p_summary_id: string }
        Returns: number
      }
      update_client: {
        Args: { p_client: Json; p_expected_version: number }
        Returns: number
      }
      update_client_trainer_preferences: {
        Args: {
          p_alias: string
          p_client_id: string
          p_expected_version: number
          p_note: string | null
        }
        Returns: number
      }
      update_own_client: {
        Args: { p_client: Json; p_expected_version: number }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
