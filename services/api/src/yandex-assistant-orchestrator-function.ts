import { actorSession } from './yandex-db-function-runtime.js'
import { proxyToYandexApi } from './yandex-api-function-proxy.js'
import { programModelJson } from './assistant-orchestrator/program/model.js'
import { verifyLlmGatewayRequest } from './yandex-llm-gateway-auth.js'
import { programIamToken } from './assistant-orchestrator/program/model.js'

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
  const raw = typeof event.body === 'string'
    ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body)
    : JSON.stringify(event.body ?? {})
  try {
    const body = JSON.parse(raw) as Record<string, unknown>
    const publicKey = process.env.YANDEX_LLM_GATEWAY_PUBLIC_KEY_B64
        ? Buffer.from(process.env.YANDEX_LLM_GATEWAY_PUBLIC_KEY_B64, 'base64').toString('utf8')
        : process.env.YANDEX_LLM_GATEWAY_PUBLIC_KEY
    const timestamp = event.headers?.['x-fit-llm-timestamp'] ?? event.headers?.['X-Fit-Llm-Timestamp']
    const signature = event.headers?.['x-fit-llm-signature'] ?? event.headers?.['X-Fit-Llm-Signature']
    if (body.kind === 'model_json') {
      if (!publicKey || !verifyLlmGatewayRequest(raw, timestamp, signature, publicKey)) return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) }
      if (typeof body.instruction !== 'string' || typeof body.functionName !== 'string'
        || typeof body.operationId !== 'string' || typeof body.maxTokens !== 'number'
        || typeof body.schema !== 'object' || body.schema === null) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_model_request' }) }
      }
      let metric: { usage: unknown; modelUri: string; requestId: string | null } | undefined
      const value = await programModelJson({
        instruction: body.instruction,
        data: body.data,
        schema: body.schema,
        maxTokens: body.maxTokens,
        functionName: body.functionName,
        operationId: body.operationId,
        ...(typeof body.timeoutMs === 'number' ? { timeoutMs: body.timeoutMs } : {}),
        onUsage: (usage, modelUri, requestId) => { metric = { usage, modelUri, requestId } },
      })
      return { statusCode: 200, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ value, metric }) }
    }
    if (body.kind === 'completion') {
      if (!publicKey || !verifyLlmGatewayRequest(raw, timestamp, signature, publicKey) || typeof body.requestBody !== 'object' || body.requestBody === null || Array.isArray(body.requestBody)) return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) }
      const requestBody = { ...(body.requestBody as Record<string, unknown>), modelUri: `gpt://${process.env.YANDEX_CLOUD_FOLDER_ID}/${process.env.YANDEX_CLOUD_MODEL_ID ?? 'yandexgpt'}/latest` }
      const token = await programIamToken()
      const response = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(90_000), body: JSON.stringify(requestBody) })
      if (!response.ok) return { statusCode: 502, headers, body: JSON.stringify({ error: `llm_http_${response.status}` }) }
      return { statusCode: 200, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ payload: await response.json(), requestId: response.headers.get('x-request-id') }) }
    }
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_request' }) }
  }
  const session = actorSession(event.headers ?? {})
  if (session === undefined) return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) }
  return proxyToYandexApi(event, '/v1/assistant/turn')
}
