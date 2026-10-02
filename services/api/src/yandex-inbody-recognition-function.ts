import { extractInBodyFromText } from './inbody-recognition.js'
import { buildYandexAiAuthorization } from './yandex-ai-authorization.js'

type Event = {
  body?: unknown
  headers?: Record<string, string | undefined>
  httpMethod?: string
  isBase64Encoded?: boolean
}
type Result = { statusCode: number; headers: Record<string, string>; body: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const OCR_URL = 'https://ai.api.cloud.yandex.net/ocr/v1/recognizeText'

function cors(event: Event): Record<string, string> {
  const origin = event.headers?.origin ?? event.headers?.Origin
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type,x-fit-session,x-fit-pilot-session',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

function bodyText(event: Event): string {
  if (typeof event.body !== 'string') return JSON.stringify(event.body ?? {})
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body
}

function header(event: Event, name: string): string | undefined {
  return event.headers?.[name] ?? event.headers?.[name.replace(/(^|-)([a-z])/g, (_all, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`)]
}

type ImageInput = { content: string; mimeType: 'JPEG' | 'PNG'; sizeBytes: number }

function imageInput(value: unknown): ImageInput | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const image = value as Record<string, unknown>
  const dataUrl = image.dataUrl
  const sizeBytes = image.sizeBytes
  if (typeof dataUrl !== 'string' || typeof sizeBytes !== 'number'
    || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_IMAGE_BYTES) return undefined
  const match = dataUrl.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!match) return undefined
  let decoded: Buffer
  try { decoded = Buffer.from(match[2]!, 'base64') } catch { return undefined }
  if (decoded.byteLength !== sizeBytes || decoded.byteLength > MAX_IMAGE_BYTES) return undefined
  return { content: match[2]!, mimeType: match[1] === 'png' ? 'PNG' : 'JPEG', sizeBytes }
}

async function authorizeClient(event: Event, clientId: string): Promise<Response> {
  const baseUrl = process.env.FIT_API_BASE_URL?.trim().replace(/\/+$/, '')
  if (!baseUrl) return new Response(JSON.stringify({ error: 'service_unavailable' }), { status: 503 })
  const session = header(event, 'x-fit-session')
  const pilotSession = header(event, 'x-fit-pilot-session')
  return fetch(`${baseUrl}/v1/clients/${encodeURIComponent(clientId)}/progress`, {
    cache: 'no-store',
    headers: {
      ...(session ? { 'x-fit-session': session } : {}),
      ...(pilotSession ? { 'x-fit-pilot-session': pilotSession } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  })
}

function ocrText(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const payload = value as Record<string, unknown>
  const annotation = payload.textAnnotation
    ?? (typeof payload.result === 'object' && payload.result !== null
      ? (payload.result as Record<string, unknown>).textAnnotation
      : undefined)
  if (typeof annotation !== 'object' || annotation === null) return undefined
  const fullText = (annotation as Record<string, unknown>).fullText
  return typeof fullText === 'string' && fullText.trim().length > 0 ? fullText : undefined
}

export async function handler(event: Event): Promise<Result> {
  const headers = cors(event)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { ...headers, allow: 'POST' }, body: JSON.stringify({ error: 'method_not_allowed' }) }

  let body: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(bodyText(event))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid')
    body = parsed as Record<string, unknown>
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_request' }) }
  }
  const clientId = body.clientId
  const image = imageInput(body.image)
  if (typeof clientId !== 'string' || !UUID.test(clientId) || image === undefined) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_request' }) }
  }

  try {
    const authorization = await authorizeClient(event, clientId)
    if (!authorization.ok) {
      const status = authorization.status === 401 || authorization.status === 403 ? authorization.status : 503
      return { statusCode: status, headers, body: JSON.stringify({ error: status === 503 ? 'service_unavailable' : 'unauthorized' }) }
    }
  } catch {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'service_unavailable' }) }
  }

  const folderId = process.env.YANDEX_CLOUD_FOLDER_ID?.trim()
  const authorization = buildYandexAiAuthorization()
  if (!folderId || authorization === undefined) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'recognition_unavailable' }) }
  }

  try {
    const response = await fetch(OCR_URL, {
      method: 'POST',
      headers: {
        authorization: await authorization.authorizationHeader(),
        'content-type': 'application/json',
        'x-folder-id': folderId,
        'x-data-logging-enabled': 'false',
      },
      body: JSON.stringify({ content: image.content, mimeType: image.mimeType, languageCodes: ['ru', 'en'], model: 'page-column-sort' }),
      signal: AbortSignal.timeout(55_000),
    })
    if (!response.ok) {
      console.error('inbody_ocr_failed', { status: response.status, requestId: response.headers.get('x-request-id') })
      return { statusCode: response.status === 429 ? 429 : 502, headers, body: JSON.stringify({ error: 'recognition_failed' }) }
    }
    const text = ocrText(await response.json())
    if (!text) return { statusCode: 422, headers, body: JSON.stringify({ error: 'inbody_not_recognized' }) }
    const result = extractInBodyFromText(text)
    if (result.recognizedFieldCount === 0) {
      return { statusCode: 422, headers, body: JSON.stringify({ error: 'inbody_not_recognized' }) }
    }
    return {
      statusCode: 200,
      headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify(result),
    }
  } catch (error) {
    console.error('inbody_ocr_unavailable', error instanceof Error ? error.message : 'unknown_error')
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'recognition_unavailable' }) }
  }
}
