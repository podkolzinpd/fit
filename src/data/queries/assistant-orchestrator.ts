import { supabase } from './client'

// Public endpoint of the authenticated Cloud Function. The endpoint accepts
// only a Supabase JWT. Production deliberately does not use a Vercel runtime
// override: a stale dashboard variable must not silently divert the pilot away
// from the Cloud Function we deploy and observe.
const productionAssistantOrchestratorUrl = 'https://functions.yandexcloud.net/d4emhmr9v0qist9dbcml'

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

export function resolveAssistantOrchestratorUrl(production: boolean, configured: unknown): string | undefined {
  const configuredValue = String(configured ?? '').trim()
  const value = (production ? productionAssistantOrchestratorUrl : configuredValue).replace(/\/$/, '')
  if (!value) return undefined
  try {
    const url = new URL(value)
    const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    const hasNoEmbeddedCredentialsOrFragments = !url.username && !url.password && !url.search && !url.hash
    return hasNoEmbeddedCredentialsOrFragments && (url.protocol === 'https:' || local) ? value : undefined
  } catch {
    return undefined
  }
}

export function assistantOrchestratorUrl(): string | undefined {
  return resolveAssistantOrchestratorUrl(
    import.meta.env.PROD,
    (import.meta.env as { VITE_ASSISTANT_ORCHESTRATOR_URL?: unknown }).VITE_ASSISTANT_ORCHESTRATOR_URL,
  )
}

export async function sendAssistantTurn(conversationId: string, turnId: string, message: string): Promise<AssistantOrchestratorReply> {
  const url = assistantOrchestratorUrl()
  if (url === undefined) throw new Error('assistant_unavailable')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('authentication_required')
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-supabase-authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ conversation_id: conversationId, turn_id: turnId, message }),
  })
  if (!response.ok) throw new Error('assistant_request_failed')
  return await response.json() as AssistantOrchestratorReply
}
