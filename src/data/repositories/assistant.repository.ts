import { assistantHistoryQueries } from '../queries/assistant-history.queries'
import { assistantOrchestratorUrl, sendAssistantTurn } from '../queries/assistant-orchestrator'
export type { AssistantOrchestratorAction } from '../queries/assistant-orchestrator'

export const assistantRepository = {
  isAvailable: () => assistantOrchestratorUrl() !== undefined,
  listConversations: assistantHistoryQueries.listConversations,
  createConversation: assistantHistoryQueries.createConversation,
  listMessages: assistantHistoryQueries.listMessages,
  sendTurn: sendAssistantTurn,
}
