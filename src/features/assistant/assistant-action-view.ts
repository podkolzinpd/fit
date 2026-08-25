type AssistantTool = 'record_workout' | 'create_client_draft' | 'create_program_draft' | 'schedule_program' | 'summarize_progress'

export type AssistantActionView = 'client-collection' | 'client-confirm' | 'client-choices' | 'workout-collection' | 'workout-confirm' | 'program-brief' | 'program-confirm' | 'summary-period' | 'summary-confirm' | 'fallback'

export function assistantActionView(action: { tool: AssistantTool; payload: Record<string, unknown> }): AssistantActionView {
  const { step, candidates } = action.payload
  if (step === 'client' && Array.isArray(candidates)) return 'client-choices'
  if (action.tool === 'create_client_draft' && (step === 'name' || step === 'profile')) return 'client-collection'
  if (action.tool === 'create_client_draft' && step === 'confirm') return 'client-confirm'
  if (action.tool === 'record_workout' && step === 'workout') return 'workout-collection'
  if (action.tool === 'record_workout' && step === 'confirm') return 'workout-confirm'
  if (action.tool === 'create_program_draft' && step === 'brief') return 'program-brief'
  if ((action.tool === 'create_program_draft' || action.tool === 'schedule_program') && step === 'confirm') return 'program-confirm'
  if (action.tool === 'summarize_progress' && step === 'period') return 'summary-period'
  if (action.tool === 'summarize_progress' && step === 'confirm') return 'summary-confirm'
  return 'fallback'
}
