import { parseWorkout } from './legacy-workout-parser/index.js'

type Event = { body?: unknown; headers?: Record<string, string | undefined>; httpMethod?: string; isBase64Encoded?: boolean }
type Result = { statusCode: number; headers: Record<string, string>; body: string }

function cors(event: Event): Record<string, string> {
  const origin = event.headers?.origin ?? event.headers?.Origin
  return { 'access-control-allow-origin': origin ?? '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type,x-supabase-authorization', 'access-control-max-age': '86400', vary: 'Origin' }
}

export async function handler(event: Event): Promise<Result> {
  const headers = cors(event)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { ...headers, allow: 'POST' }, body: JSON.stringify({ error: 'method_not_allowed' }) }
  const authorization = event.headers?.['x-supabase-authorization'] ?? event.headers?.['X-Supabase-Authorization']
  if (!authorization?.startsWith('Bearer ')) return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) }
  const raw = typeof event.body === 'string' ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : JSON.stringify(event.body ?? {})
  const response = await parseWorkout(new Request('https://yandex-function.internal/parse-workout', { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: raw }))
  return { statusCode: response.status, headers: { ...headers, 'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8' }, body: await response.text() }
}
