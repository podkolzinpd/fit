import { supabase } from './client'

// Public endpoint of the authenticated Cloud Function. The endpoint accepts
// only a Supabase JWT; VITE_ASSISTANT_ORCHESTRATOR_URL can override it, while
// this production fallback lets the one-user pilot ship without Vercel env
// access.
const productionAssistantOrchestratorUrl = 'https://functions.yandexcloud.net/d4emhmr9v0qist9dbcml'

export type AssistantOrchestratorAction = {
  tool: 'record_workout' | 'create_client_draft' | 'create_program_draft' | 'schedule_program' | 'summarize_progress'
  status: 'needs_input' | 'proposed'
  title: string
  description: string
  payload: Record<string, unknown>
}

export type AssistantOrchestratorReply = { reply: string; action: AssistantOrchestratorAction | null }

export function assistantOrchestratorUrl(): string | undefined {
  const configured = String((import.meta.env as { VITE_ASSISTANT_ORCHESTRATOR_URL?: unknown }).VITE_ASSISTANT_ORCHESTRATOR_URL ?? '').trim()
  const value = (configured || (import.meta.env.PROD ? productionAssistantOrchestratorUrl : '')).replace(/\/$/, '')
  if (!value) return undefined
  try {
    const url = new URL(value)
    const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    return url.origin === value && (url.protocol === 'https:' || local) ? value : undefined
  } catch {
    return undefined
  }
}

export async function sendAssistantTurn(conversationId: string, message: string): Promise<AssistantOrchestratorReply> {
  const url = assistantOrchestratorUrl()
  if (url === undefined) throw new Error('assistant_unavailable')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('authentication_required')
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-supabase-authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ conversation_id: conversationId, message }),
  })
  if (!response.ok) throw new Error('assistant_request_failed')
  return await response.json() as AssistantOrchestratorReply
}
