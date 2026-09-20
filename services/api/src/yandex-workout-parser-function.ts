import { actorSession } from './yandex-db-function-runtime.js'
import { proxyToYandexApi } from './yandex-api-function-proxy.js'

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
  const raw = typeof event.body === 'string' ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : JSON.stringify(event.body ?? {})
  let body: unknown
  try { body = JSON.parse(raw) } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_request' }) } }
  const path = typeof (body as { kind?: unknown })?.kind === 'string'
    ? '/v1/assistant/yandex/suggest-goal-criteria'
    : '/v1/assistant/yandex/parse-workout'
  return proxyToYandexApi({ ...event, body: raw, isBase64Encoded: false }, path)
}
