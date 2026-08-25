import { assistantHistoryQueries } from '../queries/assistant-history.queries'
import { assistantOrchestratorUrl, sendAssistantTurn } from '../queries/assistant-orchestrator'
import { toJson } from '../queries/json'
export type { AssistantOrchestratorAction } from '../queries/assistant-orchestrator'

export const assistantRepository = {
  isAvailable: () => assistantOrchestratorUrl() !== undefined,
  listConversations: assistantHistoryQueries.listConversations,
  createConversation: assistantHistoryQueries.createConversation,
  listMessages: assistantHistoryQueries.listMessages,
  sendTurn: sendAssistantTurn,
  listActions: assistantHistoryQueries.listActions,
  applyAction: (actionId: string, input: object, version: number) => assistantHistoryQueries.applyAction(actionId, toJson(input), version),
  completeSummary: assistantHistoryQueries.completeSummary,
  cancelAction: assistantHistoryQueries.cancelAction,
}
