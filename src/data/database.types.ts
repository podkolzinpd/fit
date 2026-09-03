// schema-sha256: 2adfcccce4eca8374c4f938b52079736cc6704727a679dcd11cef580f267e567

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
  id: string; client_id: string; trainer_id: string; client_name: string; created_by: string | null; workout_date: string; start_time: string | null; end_time: string | null
  started_at: string | null; completed_at: string | null; status: string; notes: string | null; trainer_review: string | null; trainer_reaction: string | null; trainer_review_author_id: string | null; trainer_reviewed_at: string | null; client_comment: string | null
  session_rpe: number | null; wellbeing: string | null; discomfort: boolean | null; has_pr: boolean
  stage_id: string | null; stage_title: string | null; version: number; total_count: number; exercises: WorkoutListExerciseRow[]
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
      app_feedback: {
        Row: {
          account_role: string
          app_version: string
          created_at: string
          display_mode: string
          id: string
          kind: string
          message: string
          screen_path: string
          telegram_last_error: string | null
          telegram_notified_at: string | null
          telegram_request_id: number | null
          telegram_sync_attempts: number
          tracker_issue_key: string | null
          tracker_last_error: string | null
          tracker_request_id: number | null
          tracker_sync_attempts: number
          user_agent: string
          user_id: string
        }
        Insert: {
          account_role: string
          app_version: string
          created_at?: string
          display_mode: string
          id?: string
          kind: string
          message: string
          screen_path: string
          telegram_last_error?: string | null
          telegram_notified_at?: string | null
          telegram_request_id?: number | null
          telegram_sync_attempts?: number
          tracker_issue_key?: string | null
          tracker_last_error?: string | null
          tracker_request_id?: number | null
          tracker_sync_attempts?: number
          user_agent: string
          user_id: string
        }
        Update: {
          account_role?: string
          app_version?: string
          created_at?: string
          display_mode?: string
          id?: string
          kind?: string
          message?: string
          screen_path?: string
          telegram_last_error?: string | null
          telegram_notified_at?: string | null
          telegram_request_id?: number | null
          telegram_sync_attempts?: number
          tracker_issue_key?: string | null
          tracker_last_error?: string | null
          tracker_request_id?: number | null
          tracker_sync_attempts?: number
          user_agent?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_actions: {
        Row: {
          applied_at: string | null
          assistant_message_id: string
          conversation_id: string
          created_at: string
          error_code: string | null
          id: string
          owner_id: string
          payload: Json
          result: Json | null
          status: string
          tool: string
          updated_at: string
          version: number
        }
        Insert: {
          applied_at?: string | null
          assistant_message_id: string
          conversation_id: string
          created_at?: string
          error_code?: string | null
          id?: string
          owner_id: string
          payload: Json
          result?: Json | null
          status?: string
          tool: string
          updated_at?: string
          version?: number
        }
        Update: {
          applied_at?: string | null
          assistant_message_id?: string
          conversation_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          owner_id?: string
          payload?: Json
          result?: Json | null
          status?: string
          tool?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "assistant_actions_assistant_message_id_fkey"
            columns: ["assistant_message_id"]
            isOneToOne: true
            referencedRelation: "assistant_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_actions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "assistant_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_conversations: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          title: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          title?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assistant_conversations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_messages: {
        Row: {
          action: Json | null
          author: string
          content: string
          conversation_id: string
          created_at: string
          id: string
          turn_id: string | null
        }
        Insert: {
          action?: Json | null
          author: string
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          turn_id?: string | null
        }
        Update: {
          action?: Json | null
          author?: string
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          turn_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "assistant_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      client_merge_operations: {
        Row: {
          actor_id: string
          completed_at: string | null
          created_at: string
          dependency_counts_after: Json
          dependency_counts_before: Json
          error_code: string | null
          id: string
          invitation_id: string | null
          source_client_id: string
          status: string
          target_client_id: string
        }
        Insert: {
          actor_id: string
          completed_at?: string | null
          created_at?: string
          dependency_counts_after?: Json
          dependency_counts_before?: Json
          error_code?: string | null
          id?: string
          invitation_id?: string | null
          source_client_id: string
          status?: string
          target_client_id: string
        }
        Update: {
          actor_id?: string
          completed_at?: string | null
          created_at?: string
          dependency_counts_after?: Json
          dependency_counts_before?: Json
          error_code?: string | null
          id?: string
          invitation_id?: string | null
          source_client_id?: string
          status?: string
          target_client_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_merge_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_merge_operations_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "client_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_merge_operations_source_client_id_fkey"
            columns: ["source_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_merge_operations_target_client_id_fkey"
            columns: ["target_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
          updated_by: string | null
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
          updated_by?: string | null
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
          updated_by?: string | null
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
          {
            foreignKeyName: "client_progress_updated_by_fkey"
            columns: ["updated_by"]
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
      client_trainer_relationships: {
        Row: {
          client_id: string
          connected_at: string
          connected_by: string
          created_at: string
          disconnected_at: string | null
          disconnected_by: string | null
          id: string
          source_invitation_id: string | null
          status: string
          trainer_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          connected_at?: string
          connected_by: string
          created_at?: string
          disconnected_at?: string | null
          disconnected_by?: string | null
          id?: string
          source_invitation_id?: string | null
          status?: string
          trainer_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          connected_at?: string
          connected_by?: string
          created_at?: string
          disconnected_at?: string | null
          disconnected_by?: string | null
          id?: string
          source_invitation_id?: string | null
          status?: string
          trainer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_trainer_relationships_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_trainer_relationships_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_trainer_relationships_disconnected_by_fkey"
            columns: ["disconnected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_trainer_relationships_source_invitation_id_fkey"
            columns: ["source_invitation_id"]
            isOneToOne: false
            referencedRelation: "client_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_trainer_relationships_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      client_trainers: {
        Row: {
          alias: string | null
          attention_snoozed_until: string | null
          client_id: string
          joined_at: string
          note: string | null
          trainer_id: string
          version: number
        }
        Insert: {
          alias?: string | null
          attention_snoozed_until?: string | null
          client_id: string
          joined_at?: string
          note?: string | null
          trainer_id: string
          version?: number
        }
        Update: {
          alias?: string | null
          attention_snoozed_until?: string | null
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
          merged_into_client_id: string | null
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
          merged_into_client_id?: string | null
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
          merged_into_client_id?: string | null
          trainer_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "clients_merged_into_client_id_fkey"
            columns: ["merged_into_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
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
          created_by: string
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
          created_by?: string
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
          created_by?: string
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
            foreignKeyName: "custom_exercises_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_exercises_partition_owner_fk"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_criteria: {
        Row: {
          archived_at: string | null
          baseline_progress_id: string | null
          baseline_recorded_on: string | null
          baseline_value: number | null
          client_id: string
          confirmation_status: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string
          custom_exercise_id: string | null
          custom_metric_id: string | null
          custom_metric_name: string | null
          exercise_name: string | null
          exercise_ref: string | null
          exercise_source: string | null
          goal_id: string
          id: string
          metric: string
          operation: string
          position: number
          range_max: number | null
          range_min: number | null
          regularity_mode: string | null
          regularity_period: string | null
          secondary_target_value: number | null
          secondary_unit: string | null
          target_value: number | null
          trainer_id: string
          unit: string
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          baseline_progress_id?: string | null
          baseline_recorded_on?: string | null
          baseline_value?: number | null
          client_id: string
          confirmation_status?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by: string
          custom_exercise_id?: string | null
          custom_metric_id?: string | null
          custom_metric_name?: string | null
          exercise_name?: string | null
          exercise_ref?: string | null
          exercise_source?: string | null
          goal_id: string
          id?: string
          metric: string
          operation: string
          position?: number
          range_max?: number | null
          range_min?: number | null
          regularity_mode?: string | null
          regularity_period?: string | null
          secondary_target_value?: number | null
          secondary_unit?: string | null
          target_value?: number | null
          trainer_id: string
          unit: string
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          baseline_progress_id?: string | null
          baseline_recorded_on?: string | null
          baseline_value?: number | null
          client_id?: string
          confirmation_status?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string
          custom_exercise_id?: string | null
          custom_metric_id?: string | null
          custom_metric_name?: string | null
          exercise_name?: string | null
          exercise_ref?: string | null
          exercise_source?: string | null
          goal_id?: string
          id?: string
          metric?: string
          operation?: string
          position?: number
          range_max?: number | null
          range_min?: number | null
          regularity_mode?: string | null
          regularity_period?: string | null
          secondary_target_value?: number | null
          secondary_unit?: string | null
          target_value?: number | null
          trainer_id?: string
          unit?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "goal_criteria_baseline_progress_fk"
            columns: ["baseline_progress_id", "trainer_id", "client_id"]
            isOneToOne: false
            referencedRelation: "client_progress"
            referencedColumns: ["id", "trainer_id", "client_id"]
          },
          {
            foreignKeyName: "goal_criteria_custom_exercise_fk"
            columns: ["custom_exercise_id", "trainer_id"]
            isOneToOne: false
            referencedRelation: "custom_exercises"
            referencedColumns: ["id", "trainer_id"]
          },
          {
            foreignKeyName: "goal_criteria_custom_metric_fk"
            columns: ["custom_metric_id", "trainer_id", "client_id"]
            isOneToOne: false
            referencedRelation: "client_custom_metrics"
            referencedColumns: ["id", "trainer_id", "client_id"]
          },
          {
            foreignKeyName: "goal_criteria_goal_fk"
            columns: ["goal_id", "trainer_id", "client_id"]
            isOneToOne: false
            referencedRelation: "client_goals"
            referencedColumns: ["id", "trainer_id", "client_id"]
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
      notification_preferences: {
        Row: {
          enabled: boolean
          kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          kind: string
          updated_at?: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      user_feature_flags: {
        Row: {
          monochrome_preview: boolean
          user_id: string
        }
        Insert: {
          monochrome_preview?: boolean
          user_id: string
        }
        Update: {
          monochrome_preview?: boolean
          user_id?: string
        }
        Relationships: []
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
          updated_by: string | null
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
          updated_by?: string | null
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
          updated_by?: string | null
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
            foreignKeyName: "workout_exercises_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
          updated_by: string | null
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
          updated_by?: string | null
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
          updated_by?: string | null
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
          {
            foreignKeyName: "workout_sets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workouts: {
        Row: {
          client_comment: string | null
          client_id: string
          client_question: string | null
          client_question_asked_at: string | null
          client_question_resolved_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          discomfort: boolean | null
          end_time: string | null
          feedback_submitted_at: string | null
          id: string
          notes: string | null
          session_rpe: number | null
          stage_id: string | null
          start_time: string | null
          started_at: string | null
          status: string
          trainer_id: string
          trainer_reaction: string | null
          trainer_review: string | null
          trainer_review_author_id: string | null
          trainer_reviewed_at: string | null
          updated_at: string
          updated_by: string | null
          version: number
          wellbeing: string | null
          workout_date: string
        }
        Insert: {
          client_comment?: string | null
          client_id: string
          client_question?: string | null
          client_question_asked_at?: string | null
          client_question_resolved_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discomfort?: boolean | null
          end_time?: string | null
          feedback_submitted_at?: string | null
          id?: string
          notes?: string | null
          session_rpe?: number | null
          stage_id?: string | null
          start_time?: string | null
          started_at?: string | null
          status?: string
          trainer_id: string
          trainer_reaction?: string | null
          trainer_review?: string | null
          trainer_review_author_id?: string | null
          trainer_reviewed_at?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
          wellbeing?: string | null
          workout_date: string
        }
        Update: {
          client_comment?: string | null
          client_id?: string
          client_question?: string | null
          client_question_asked_at?: string | null
          client_question_resolved_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discomfort?: boolean | null
          end_time?: string | null
          feedback_submitted_at?: string | null
          id?: string
          notes?: string | null
          session_rpe?: number | null
          stage_id?: string | null
          start_time?: string | null
          started_at?: string | null
          status?: string
          trainer_id?: string
          trainer_reaction?: string | null
          trainer_review?: string | null
          trainer_review_author_id?: string | null
          trainer_reviewed_at?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
          wellbeing?: string | null
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
          {
            foreignKeyName: "workouts_trainer_review_author_id_fkey"
            columns: ["trainer_review_author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workouts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      answer_workout_question: {
        Args: {
          p_expected_version: number
          p_reaction: string | null
          p_review: string
          p_workout_id: string
        }
        Returns: number
      }
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
      apply_assistant_action: {
        Args: {
          p_action_id: string
          p_expected_version?: number
          p_input?: Json
        }
        Returns: Json
      }
      archive_client_goal: {
        Args: { p_expected_version: number; p_goal_id: string }
        Returns: undefined
      }
      ask_workout_question: {
        Args: {
          p_expected_version: number
          p_question: string
          p_workout_id: string
        }
        Returns: number
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
      cancel_assistant_action: {
        Args: { p_action_id: string; p_expected_version?: number }
        Returns: Json
      }
      cancel_planned_workout: {
        Args: { p_expected_version: number; p_workout_id: string }
        Returns: number
      }
      claim_client_invitation: { Args: { p_code: string }; Returns: string }
      complete_assistant_summary: {
        Args: { p_action_id: string; p_expected_version?: number }
        Returns: Json
      }
      confirm_live_set: {
        Args: { p_expected_version: number; p_set_id: string }
        Returns: number
      }
      create_client: { Args: { p_client: Json }; Returns: string }
      create_client_custom_metric: {
        Args: { p_client_id: string; p_name: string; p_unit?: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "client_custom_metrics"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_client_invitation: {
        Args: { p_client_id: string; p_target_role: string }
        Returns: string
      }
      create_own_client: { Args: { p_client: Json }; Returns: string }
      create_quick_client: { Args: { p_full_name: string }; Returns: string }
      create_quick_own_client: {
        Args: { p_full_name: string }
        Returns: string
      }
      delete_goal_stage: { Args: { p_stage_id: string }; Returns: undefined }
      disconnect_client_trainer: {
        Args: { p_client_id: string }
        Returns: Json
      }
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
      get_workout_regularity: {
        Args: { p_client_id: string; p_reference_time?: string }
        Returns: {
          completed_count: number
          completed_planned_count: number
          completion_percent: number
          partial_count: number
          period: string
          period_end: string
          period_start: string
          planned_count: number
          skipped_count: number
        }[]
      }
      goal_criterion_payload_valid: {
        Args: { p_client_id: string; p_criterion: Json; p_trainer_id: string }
        Returns: boolean
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
      list_exercise_progress: {
        Args: {
          p_before_completed_at?: string | null
          p_before_workout_id?: string | null
          p_client_id: string
          p_exercise_ref: string
          p_limit?: number
        }
        Returns: {
          all_time_best_weight_kg: number | null
          all_time_best_weight_reps: number | null
          all_time_primary_value: number | null
          best_weight_kg: number | null
          best_weight_reps: number | null
          completed_at: string
          confirmed_set_count: number
          exercise_name: string
          input_kind: string
          is_primary_pr: boolean
          is_weight_pr: boolean
          is_weight_reps_pr: boolean
          previous_primary_value: number | null
          primary_change: number | null
          primary_value: number | null
          reps_at_best_weight: number | null
          sets: Json
          total_count: number
          trainer_comment: string | null
          workout_date: string
          workout_id: string
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
      list_running_progress: {
        Args: {
          p_client_id: string
          p_period_end: string
          p_period_start: string
        }
        Returns: {
          distance_km: number
          duration_sec: number
          pace_sec_per_km: number
          rpe: number
          running_format: string
          workout_date: string
          workout_id: string
        }[]
      }
      list_trainer_attention_workouts: {
        Args: never
        Returns: {
          client_comment: string
          client_id: string
          client_name: string
          client_question: string
          client_question_asked_at: string
          discomfort: boolean
          feedback_submitted_at: string
          version: number
          workout_date: string
          workout_id: string
        }[]
      }
      list_workout_personal_records: {
        Args: { p_workout_id: string }
        Returns: {
          exercise_name: string
          exercise_ref: string
          input_kind: string
          metric: string
          primary_value: number
          reps: number
          weight_kg: number
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
      persist_assistant_response: {
        Args: {
          p_action?: Json
          p_content: string
          p_conversation_id: string
          p_turn_id: string
        }
        Returns: Json
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
      reconnect_client_trainer: { Args: { p_code: string }; Returns: string }
      record_planned_workout_result: {
        Args: { p_expected_version: number; p_workout: Json }
        Returns: string
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
      reschedule_workout: {
        Args: {
          p_expected_version: number
          p_start_time: string | null
          p_workout_date: string
          p_workout_id: string
        }
        Returns: number
      }
      resolve_workout_question: {
        Args: { p_expected_version: number; p_workout_id: string }
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
      set_client_custom_metric_archived: {
        Args: {
          p_archived: boolean
          p_expected_version: number
          p_metric_id: string
        }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "client_custom_metrics"
          isOneToOne: true
          isSetofReturn: false
        }
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
          p_reaction: string
          p_review: string
          p_workout_id: string
        }
        Returns: number
      }
      snooze_client_attention: {
        Args: { p_client_id: string }
        Returns: string
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
      submit_app_feedback: {
        Args: {
          p_app_version: string
          p_display_mode: string
          p_kind: string
          p_message: string
          p_screen_path: string
          p_user_agent: string
        }
        Returns: string
      }
      submit_workout_feedback: {
        Args: {
          p_comment: string
          p_discomfort: boolean
          p_expected_version: number
          p_session_rpe: number
          p_wellbeing: string
          p_workout_id: string
        }
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
      workout_has_personal_record: {
        Args: { p_workout_id: string }
        Returns: boolean
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
