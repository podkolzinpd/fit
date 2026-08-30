import { parsePushRequest, PushRequestError } from './push-notifications/parse-request.js'
import { sendPushNotifications } from './push-notifications/send.js'

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

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type,x-push-dispatch-secret',
  'access-control-max-age': '86400',
}

function readBody(event: FunctionEvent): string {
  if (typeof event.body === 'string') {
    return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
  }
  return JSON.stringify(event.body ?? {})
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name}_not_configured`)
  return value
}

function json(statusCode: number, body: unknown): FunctionResponse {
  return { statusCode, headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) }
}

/**
 * Production Yandex Cloud Function entry point for `fit-send-push-notifications`.
 * Unlike `yandex-summary-function`, the caller is not an end user but the
 * `private.dispatch_push_notifications` pg_cron job in Supabase — auth is a
 * shared secret (PUSH_DISPATCH_SECRET).
 *
 * The secret travels in a custom `X-Push-Dispatch-Secret` header, not the
 * standard `Authorization` header: Yandex Cloud's own API Gateway intercepts
 * any `Authorization` header on a public-invoke function and tries to
 * validate it as a platform IAM token, rejecting the request with a gateway
 * 403 before it ever reaches this handler — regardless of the function's
 * public-invoke setting. A custom header sidesteps that entirely.
 */
export async function handler(event: FunctionEvent): Promise<FunctionResponse> {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed' })
  }

  const providedSecret = event.headers?.['x-push-dispatch-secret'] ?? event.headers?.['X-Push-Dispatch-Secret']
  const expectedSecret = requiredEnv('PUSH_DISPATCH_SECRET')
  if (providedSecret !== expectedSecret) {
    return json(401, { error: 'authentication_required' })
  }

  let notifications
  try {
    notifications = parsePushRequest(JSON.parse(readBody(event)))
  } catch (error) {
    if (error instanceof PushRequestError) return json(error.status, { error: error.message })
    return json(400, { error: 'invalid_json' })
  }

  const vapid = {
    publicKey: requiredEnv('VAPID_PUBLIC_KEY'),
    privateKey: requiredEnv('VAPID_PRIVATE_KEY'),
    subject: requiredEnv('VAPID_SUBJECT'),
  }

  const results = await sendPushNotifications(notifications, vapid)
  return json(200, { results })
}
