import type { AppFeedbackInput } from '../repositories/app-feedback.repository'
import { getSupabaseClient } from './client'
import type { Json } from '../database.types'

export const appFeedbackQueries = {
  submit: (input: AppFeedbackInput) => getSupabaseClient().rpc('submit_app_feedback', {
    p_kind: input.kind,
    p_message: input.message,
    p_screen_path: input.screenPath,
    p_app_version: input.appVersion,
    p_display_mode: input.displayMode,
    p_user_agent: input.userAgent,
    p_model_input_json: input.modelInputJson as Json ?? null,
    p_model_output_json: input.modelOutputJson as Json ?? null,
  }),
}
