import { readAssistantProgressRequest } from './assistant-progress-request.js'
import { actorSession } from './yandex-db-function-runtime.js'
import { proxyToYandexApi } from './yandex-api-function-proxy.js'

type FunctionEvent = { body?: unknown; headers?: Record<string, string | undefined>; httpMethod?: string; isBase64Encoded?: boolean }
type FunctionResponse = { statusCode: number; headers: Record<string, string>; body: string }

function corsHeaders(event: FunctionEvent): Record<string, string> {
  const origin = event.headers?.origin ?? event.headers?.Origin
  return { 'access-control-allow-origin': origin ?? '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type,x-fit-session,x-fit-pilot-session', 'access-control-max-age': '86400', vary: 'Origin' }
}

function readBody(event: FunctionEvent): string {
  if (typeof event.body === 'string') return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
  return JSON.stringify(event.body ?? {})
}

export async function handler(event: FunctionEvent): Promise<FunctionResponse> {
  const cors = corsHeaders(event)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { ...cors, allow: 'POST' }, body: JSON.stringify({ error: 'method_not_allowed' }) }
  const session = actorSession(event.headers ?? {})
  if (session === undefined) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'authentication_required' }) }
  let body: unknown
  try { body = JSON.parse(readBody(event)) } catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_request' }) } }
  const clientId = (body as { client_id?: unknown })?.client_id
  if (typeof clientId !== 'string') return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_request' }) }
  return proxyToYandexApi({ ...event, body: readBody(event), isBase64Encoded: false }, `/v1/clients/${encodeURIComponent(clientId)}/training-summaries/generate`)
}
