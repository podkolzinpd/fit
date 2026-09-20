import { WorkoutParseError, YandexWorkoutParser } from './legacy-workout-parser.js'
import { DatabasePilotWorkoutParser } from './pilot-workout-parser.js'
import { actorSession, yandexAiAuthorization, yandexDatabasePool } from './yandex-db-function-runtime.js'

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
  const authorization = yandexAiAuthorization()
  if (pool === undefined || authorization === undefined) return { statusCode: 503, headers, body: JSON.stringify({ error: 'service_unavailable' }) }
  const raw = typeof event.body === 'string' ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : JSON.stringify(event.body ?? {})
  let body: unknown
  try { body = JSON.parse(raw) } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_request' }) } }
  try {
    const parser = new DatabasePilotWorkoutParser(pool, new YandexWorkoutParser(authorization, process.env.YANDEX_CLOUD_FOLDER_ID ?? '', process.env.YANDEX_CLOUD_MODEL_ID))
    let result
    if (typeof (body as { kind?: unknown })?.kind === 'string') {
      if (parser.suggest === undefined) return { statusCode: 503, headers, body: JSON.stringify({ error: 'service_unavailable' }) }
      result = await parser.suggest(session, body)
    } else {
      result = await parser.parse(session, body)
    }
    return { statusCode: 200, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(result) }
  } catch (error) {
    if (error instanceof WorkoutParseError) return { statusCode: error.status, headers, body: JSON.stringify({ error: error.code }) }
    console.error('yandex_workout_parser_failed', error instanceof Error ? error.message : 'unknown_error')
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'service_unavailable' }) }
  }
}
