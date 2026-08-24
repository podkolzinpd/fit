export type AssistantToolName =
  | 'record_workout'
  | 'create_client_draft'
  | 'create_program_draft'
  | 'schedule_program'
  | 'summarize_progress'

export type AssistantActionStatus = 'needs_input' | 'proposed' | 'confirmed' | 'applied' | 'failed' | 'cancelled'

export type AssistantMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

/**
 * A model may only propose one of these actions. The app renders the payload,
 * asks the person for confirmation, and then calls an ordinary domain command.
 */
export type AssistantActionDraft<TPayload = Record<string, unknown>> = {
  id: string
  tool: AssistantToolName
  status: AssistantActionStatus
  title: string
  description: string
  payload: TPayload
  requiresConfirmation: boolean
}

export type ProgressSummaryRequest = {
  clientId: string
  periodStart: string
  periodEnd: string
  force: boolean
}

export type ProgressSummaryDraft = AssistantActionDraft<ProgressSummaryRequest & {
  clientName: string
  preview: string
}>
