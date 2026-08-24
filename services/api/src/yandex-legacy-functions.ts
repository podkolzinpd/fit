import { SupabaseWorkoutParser, WorkoutParseError } from './legacy-workout-parser.js'
import { summarizeClientTraining as summarizeLegacyClientTraining } from './legacy-summary/index.js'
import { readSupabaseBridgeConfig, SupabaseBridge } from './supabase-bridge.js'

type YandexHttpEvent = {
  body?: unknown
  headers?: Record<string, string | undefined>
  httpMethod?: string
  isBase64Encoded?: boolean
}

type YandexHttpResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string
}

function json(statusCode: number, value: unknown, headers: Record<string, string> = {}): YandexHttpResponse {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(value),
  }
}

function requestBody(event: YandexHttpEvent): string {
  if (typeof event.body === 'string') {
    return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
  }
  return JSON.stringify(event.body ?? {})
}

function authorization(event: YandexHttpEvent): string | undefined {
  const headers = event.headers ?? {}
  return headers['x-supabase-authorization'] ?? headers['X-Supabase-Authorization']
}

function legacyConfig(): { bridge: SupabaseBridge; yandexApiKey: string; folderId: string; modelId?: string } | undefined {
  const config = readSupabaseBridgeConfig()
  const yandexApiKey = process.env.YANDEX_CLOUD_API_KEY
  const folderId = process.env.YANDEX_CLOUD_FOLDER_ID
  if (config === undefined || yandexApiKey === undefined || folderId === undefined) return undefined
  return {
    bridge: new SupabaseBridge(config),
    yandexApiKey,
    folderId,
    ...(process.env.YANDEX_CLOUD_MODEL_ID === undefined ? {} : { modelId: process.env.YANDEX_CLOUD_MODEL_ID }),
  }
}

/** Yandex Cloud Functions entry point for the former `parse-workout` Edge Function. */
export async function parseWorkout(event: YandexHttpEvent): Promise<YandexHttpResponse> {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' })
  const actorToken = authorization(event)
  if (actorToken === undefined || !actorToken.startsWith('Bearer ')) return json(401, { error: 'unauthorized' })
  const config = legacyConfig()
  if (config === undefined) return json(503, { error: 'service_unavailable' })

  let body: unknown
  try {
    body = JSON.parse(requestBody(event))
  } catch {
    return json(400, { error: 'invalid_request' })
  }

  try {
    const data = await new SupabaseWorkoutParser(
      config.bridge,
      config.yandexApiKey,
      config.folderId,
      config.modelId,
    ).parse(actorToken, body)
    return json(200, data)
  } catch (error) {
    if (!(error instanceof WorkoutParseError)) throw error
    if (error.status === 502) {
      return json(502, { error: { code: error.code, message: 'Не удалось разобрать диктовку' } })
    }
    return json(error.status, { error: error.code })
  }
}

/** Yandex Cloud Functions entry point for the former `summarize-client-training` Edge Function. */
export async function summarizeClientTraining(event: YandexHttpEvent): Promise<YandexHttpResponse> {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' })
  const actorToken = authorization(event)
  if (actorToken === undefined || !actorToken.startsWith('Bearer ')) return json(401, { error: 'authentication_required' })
  if (legacyConfig() === undefined) return json(503, { error: 'service_unavailable' })

  const response = await summarizeLegacyClientTraining(new Request('https://yandex-function.internal/', {
    method: 'POST',
    headers: { authorization: actorToken, 'content-type': 'application/json' },
    body: requestBody(event),
  }))
  return {
    statusCode: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      ...(response.headers.get('x-fit-error-code') === null ? {} : { 'x-fit-error-code': response.headers.get('x-fit-error-code')! }),
    },
    body: await response.text(),
  }
}
