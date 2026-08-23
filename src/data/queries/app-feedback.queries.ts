import type { AppFeedbackInput } from '../repositories/app-feedback.repository'
import { supabase } from './client'

export const appFeedbackQueries = {
  submit: (input: AppFeedbackInput) => supabase.rpc('submit_app_feedback', {
    p_kind: input.kind,
    p_message: input.message,
    p_screen_path: input.screenPath,
    p_app_version: input.appVersion,
    p_display_mode: input.displayMode,
    p_user_agent: input.userAgent,
  }),
}

