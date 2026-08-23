import { summarizeClientTraining } from './legacy-summary/index.js'

type FunctionEvent = {
  body?: unknown
  headers?: Record<string, string | undefined>
  httpMethod?: string
  isBase64Encoded?: boolean
}

type FunctionResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string
}

function corsHeaders(event: FunctionEvent): Record<string, string> {
  const origin = event.headers?.origin ?? event.headers?.Origin
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type,x-supabase-authorization',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

function readAuthorization(event: FunctionEvent): string | undefined {
  return event.headers?.['x-supabase-authorization']
    ?? event.headers?.['X-Supabase-Authorization']
}

function readBody(event: FunctionEvent): string {
  if (typeof event.body === 'string') {
    return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
  }
  return JSON.stringify(event.body ?? {})
}

/**
 * Production Yandex Cloud Function entry point for `summarize-client-training`.
 * Supabase remains the source of Auth and data while this function performs the
 * same authorization, aggregation, YandexGPT request and writes as the legacy
 * Edge Function.
 */
export async function handler(event: FunctionEvent): Promise<FunctionResponse> {
  const cors = corsHeaders(event)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...cors, allow: 'POST' }, body: JSON.stringify({ error: 'method_not_allowed' }) }
  }
  const authorization = readAuthorization(event)
  if (authorization === undefined || !authorization.startsWith('Bearer ')) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'authentication_required' }) }
  }

  const upstream = await summarizeClientTraining(new Request('https://yandex-function.internal/summarize-client-training', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: readBody(event),
  }))
  const errorCode = upstream.headers.get('x-fit-error-code')
  return {
    statusCode: upstream.status,
    headers: {
      ...cors,
      'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
      ...(errorCode === null ? {} : { 'x-fit-error-code': errorCode }),
    },
    body: await upstream.text(),
  }
}
