import { supabase } from './client'
import { legacyCloudApiBaseUrl } from './legacy-cloud-functions'

export type AssistantProgressSummaryRequest = {
  clientId: string
  periodStart: string
  periodEnd: string
  force?: boolean
}

export type AssistantProgressSummaryResult<T> = {
  data: T | null
  error: Error | { context: Response } | null
}

/**
 * Transport for the first read-only assistant tool. It is intentionally
 * separate from the sandbox renderer: an explicit API base URL is required,
 * so a local UI cannot accidentally leave the device.
 */
export async function invokeAssistantProgressSummary<T>(
  request: AssistantProgressSummaryRequest,
): Promise<AssistantProgressSummaryResult<T> | undefined> {
  const baseUrl = legacyCloudApiBaseUrl()
  if (baseUrl === undefined) return undefined
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { data: null, error: new Error('authentication_required') }
  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/assistant/progress-summary`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-supabase-authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        client_id: request.clientId,
        period_start: request.periodStart,
        period_end: request.periodEnd,
        force: request.force === true,
      }),
    })
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error('assistant_progress_request_failed') }
  }
  if (!response.ok) return { data: null, error: { context: response } }
  try {
    return { data: await response.json() as T, error: null }
  } catch {
    return { data: null, error: new Error('invalid_json') }
  }
}
