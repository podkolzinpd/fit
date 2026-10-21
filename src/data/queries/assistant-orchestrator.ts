import { yandexAppSessionTransport } from '../yandex-app-session-transport'
import { attachRequestDiagnostics } from '../../shared/request-diagnostics'
import { diagnosticsForResponse, fetchWithRequestDiagnostics } from './request-diagnostics'

export type AssistantOrchestratorAction = {
  id?: string
  tool: 'record_workout' | 'create_client_draft' | 'create_program_draft' | 'schedule_program' | 'summarize_progress'
  status: 'needs_input' | 'proposed'
  title: string
  description: string
  payload: Record<string, unknown>
  lifecycleStatus?: 'proposed' | 'applying' | 'applied' | 'failed' | 'cancelled'
  result?: Record<string, unknown> | null
}

export type AssistantOrchestratorReply = { reply: string; action: AssistantOrchestratorAction | null }

export function isAssistantTransportAvailable(): boolean {
  return yandexAppSessionTransport() !== null
}

export async function sendAssistantTurn(conversationId: string, turnId: string, message: string): Promise<AssistantOrchestratorReply> {
  const appSession = yandexAppSessionTransport()
  if (appSession) {
    const response = await fetchWithRequestDiagnostics(globalThis.fetch, `${appSession.apiBaseUrl}/v1/assistant/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fit-session': appSession.sessionToken },
      body: JSON.stringify({ conversation_id: conversationId, turn_id: turnId, message }),
    })
    if (!response.ok) throw attachRequestDiagnostics(
      new Error('assistant_request_failed'),
      diagnosticsForResponse(response),
    )
    try {
      return await response.json() as AssistantOrchestratorReply
    } catch (error) {
      throw attachRequestDiagnostics(
        new Error('assistant_response_invalid', { cause: error }),
        diagnosticsForResponse(response, 'response'),
      )
    }
  }
  throw new Error('authentication_required')
}
