import { aiStudioUsage, reportAiStudioMetric } from '../../ai-studio-usage-metrics.js'
import { signLlmGatewayRequest } from '../../yandex-llm-gateway-auth.js'

export async function programIamToken(): Promise<string> {
  const response = await fetch('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error('program_auth_unavailable')
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || !('access_token' in value) || typeof value.access_token !== 'string') throw new Error('program_auth_unavailable')
  return value.access_token
}

export async function programModelJson(input: {
  instruction: string; data: unknown; schema: object; maxTokens: number; functionName: string; operationId: string; timeoutMs?: number; onUsage?: (usage: unknown, modelUri: string, requestId: string | null) => void; onRequest?: (request: Record<string, unknown>) => void; onResponse?: (response: unknown) => void
}): Promise<unknown> {
  const gateway = process.env.YANDEX_LLM_FUNCTION_URL?.trim()
  if (gateway) {
    const privateKey = process.env.YANDEX_LLM_GATEWAY_PRIVATE_KEY
    if (!privateKey) throw new Error('program_model_gateway_unconfigured')
    const requestBody = JSON.stringify({ kind: 'model_json', ...input })
    const auth = signLlmGatewayRequest(requestBody, privateKey)
    const response = await fetch(gateway, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fit-llm-timestamp': auth.timestamp, 'x-fit-llm-signature': auth.signature },
      signal: AbortSignal.timeout(input.timeoutMs ?? 90_000),
      body: requestBody,
    })
    if (!response.ok) throw new Error(`program_model_gateway_http_${response.status}`)
    const payload = await response.json() as { value?: unknown; metric?: { usage: unknown; modelUri: string; requestId: string | null } }
    if (!('value' in payload)) throw new Error('program_model_gateway_invalid_response')
    if (payload.metric?.modelUri && input.onUsage) input.onUsage(payload.metric.usage, payload.metric.modelUri, payload.metric.requestId)
    input.onResponse?.(payload.value)
    return payload.value
  }
  const folder = process.env.YANDEX_CLOUD_FOLDER_ID?.trim()
  if (!folder) throw new Error('program_model_unconfigured')
  const token = await programIamToken()
  const modelUri = `gpt://${folder}/${process.env.YANDEX_CLOUD_MODEL_ID ?? 'yandexgpt'}/latest`
  const requestBody = { modelUri, completionOptions: { stream: false, temperature: 0.1, maxTokens: String(input.maxTokens) },
    jsonSchema: { schema: input.schema }, messages: [
      { role: 'system', text: input.instruction },
      { role: 'user', text: JSON.stringify(input.data) },
    ] }
  input.onRequest?.(requestBody)
  const response = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(input.timeoutMs ?? 90_000),
    body: JSON.stringify(requestBody),
  })
  if (!response.ok) throw new Error(`program_model_http_${response.status}`)
  const payload = await response.json() as { result?: { alternatives?: { message?: { text?: string }; status?: string }[]; usage?: unknown } }
  if (input.onUsage) input.onUsage(payload.result?.usage, modelUri, response.headers.get('x-request-id'))
  else await reportAiStudioMetric({ functionName: input.functionName, modelUri, invocationId: input.operationId,
    iamToken: token, upstreamRequestId: response.headers.get('x-request-id'), usage: aiStudioUsage(payload.result?.usage) })
  const result = payload.result?.alternatives?.[0]
  if (!result?.message?.text || result.status === 'ALTERNATIVE_STATUS_TRUNCATED_FINAL') throw new Error('program_model_incomplete')
  const parsed = JSON.parse(result.message.text) as unknown
  input.onResponse?.(parsed)
  return parsed
}

export function isProgramEnabled(userId: string): boolean {
  // Role and client ownership are checked by the authenticated orchestrator.
  // The generator remains private to its service account.
  return process.env.ASSISTANT_PROGRAM_ENABLED === 'true' && userId.trim().length > 0
}
