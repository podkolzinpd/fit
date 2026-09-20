import { readAssistantProgressRequest } from './assistant-progress-request.js'
import { HttpError } from './legacy-summary/index.js'
import { DatabasePilotTrainingSummaries, PilotTrainingSummaryError } from './training-summary.js'
import { actorSession, yandexAiAuthorization, yandexDatabasePool } from './yandex-db-function-runtime.js'

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
  const pool = yandexDatabasePool()
  const authorization = yandexAiAuthorization()
  if (pool === undefined || authorization === undefined) return { statusCode: 503, headers: cors, body: JSON.stringify({ error: 'service_unavailable' }) }
  let body: unknown
  try { body = JSON.parse(readBody(event)) } catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_request' }) } }
  const command = readAssistantProgressRequest(body)
  if (command === undefined) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_request' }) }
  try {
    const result = await new DatabasePilotTrainingSummaries(pool, authorization).generate(session, {
      clientId: command.clientId,
      periodStart: command.periodStart,
      periodEnd: command.periodEnd,
      force: command.force,
      triggerReason: 'manual_refresh',
    })
    return { statusCode: 200, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(result) }
  } catch (error) {
    if (error instanceof PilotTrainingSummaryError || error instanceof HttpError) {
      return { statusCode: error.status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'x-fit-error-code': error.message }, body: JSON.stringify({ error: error.message }) }
    }
    console.error('yandex_training_summary_failed', error instanceof Error ? error.message : 'unknown_error')
    return { statusCode: 503, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'x-fit-error-code': 'service_unavailable' }, body: JSON.stringify({ error: 'service_unavailable' }) }
  }
}
