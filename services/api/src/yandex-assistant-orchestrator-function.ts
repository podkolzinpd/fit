import { AssistantStateError } from './assistant-state.js'
import { readAssistantTurnRequest } from './assistant-state-request.js'
import { DatabasePilotAssistantTurnRunner } from './pilot-assistant-turn.js'
import { actorSession, yandexDatabasePool } from './yandex-db-function-runtime.js'

type Event = { body?: unknown; headers?: Record<string, string | undefined>; httpMethod?: string; isBase64Encoded?: boolean }
type Result = { statusCode: number; headers: Record<string, string>; body: string }

function cors(event: Event): Record<string, string> {
  const origin = event.headers?.origin ?? event.headers?.Origin
  return { 'access-control-allow-origin': origin ?? '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type,x-fit-session,x-fit-pilot-session', 'access-control-max-age': '86400', vary: 'Origin' }
}

export async function handler(event: Event): Promise<Result> {
  const headers = cors(event)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { ...headers, allow: 'POST' }, body: JSON.stringify({ error: 'method_not_allowed' }) }
  const session = actorSession(event.headers ?? {})
  if (session === undefined) return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) }
  const pool = yandexDatabasePool()
  if (pool === undefined) return { statusCode: 503, headers, body: JSON.stringify({ error: 'service_unavailable' }) }
  const raw = typeof event.body === 'string' ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : JSON.stringify(event.body ?? {})
  let body: unknown
  try { body = JSON.parse(raw) } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_request' }) } }
  const command = readAssistantTurnRequest(body)
  if (command === undefined) return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_request' }) }
  try {
    const result = await new DatabasePilotAssistantTurnRunner(pool).runTurn(session, command)
    return { statusCode: 200, headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(result) }
  } catch (error) {
    if (error instanceof AssistantStateError) {
      const status = error.failure === 'conflict' ? 409 : error.failure === 'not_found' ? 404 : error.failure === 'forbidden' ? 403 : 400
      return { statusCode: status, headers, body: JSON.stringify({ error: error.failure }) }
    }
    console.error('yandex_assistant_orchestrator_failed', error instanceof Error ? error.message : 'unknown_error')
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'service_unavailable' }) }
  }
}
