import { signLlmGatewayRequest } from './yandex-llm-gateway-auth.js'

export async function invokeYandexLlmCompletion(requestBody: Record<string, unknown>, timeoutMs: number, request: typeof fetch = fetch): Promise<{ payload: unknown; requestId: string | null }> {
  const gateway = process.env.YANDEX_LLM_FUNCTION_URL?.trim()
  const privateKey = process.env.YANDEX_LLM_GATEWAY_PRIVATE_KEY
  if (!gateway || !privateKey) throw new Error('llm_gateway_unconfigured')
  const body = JSON.stringify({ kind: 'completion', requestBody })
  const auth = signLlmGatewayRequest(body, privateKey)
  const response = await request(gateway, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fit-llm-timestamp': auth.timestamp, 'x-fit-llm-signature': auth.signature }, signal: AbortSignal.timeout(timeoutMs), body })
  if (!response.ok) throw new Error(`llm_gateway_http_${response.status}`)
  const result = await response.json() as { payload?: unknown; requestId?: string | null }
  if (!('payload' in result)) throw new Error('llm_gateway_invalid_response')
  return { payload: result.payload, requestId: result.requestId ?? null }
}
