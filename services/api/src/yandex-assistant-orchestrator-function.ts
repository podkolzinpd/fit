import { assistantOrchestrator } from './assistant-orchestrator/index.js'

type Event = { body?: unknown; headers?: Record<string, string | undefined>; httpMethod?: string; isBase64Encoded?: boolean }
type Result = { statusCode: number; headers: Record<string, string>; body: string }
type InvocationContext = { requestId?: string; token?: { access_token?: string } }

function headers(event: Event): Record<string, string> {
  const origin = event.headers?.origin ?? event.headers?.Origin
  return { 'access-control-allow-origin': origin ?? '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type,x-supabase-authorization', 'access-control-max-age': '86400', vary: 'Origin' }
}

export async function handler(event: Event, context?: InvocationContext): Promise<Result> {
  const cors = headers(event)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { ...cors, allow: 'POST' }, body: JSON.stringify({ error: 'method_not_allowed' }) }
  const authorization = event.headers?.['x-supabase-authorization'] ?? event.headers?.['X-Supabase-Authorization']
  const raw = typeof event.body === 'string' ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : JSON.stringify(event.body ?? {})
  const response = await assistantOrchestrator(new Request('https://yandex-function.internal/assistant-orchestrator', {
    method: 'POST',
    headers: {
      authorization: authorization ?? '',
      'content-type': 'application/json',
      ...(context?.requestId === undefined ? {} : { 'x-yc-request-id': context.requestId }),
      ...(context?.token?.access_token === undefined ? {} : { 'x-yc-iam-token': context.token.access_token }),
    },
    body: raw,
  }))
  return { statusCode: response.status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' }, body: await response.text() }
}
