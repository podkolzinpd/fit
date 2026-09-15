import { aiStudioUsage, reportAiStudioMetric } from '../../ai-studio-usage-metrics.js'

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
  instruction: string; data: unknown; schema: object; maxTokens: number; functionName: string; operationId: string; onUsage?: (usage: unknown, modelUri: string, requestId: string | null) => void
}): Promise<unknown> {
  const folder = process.env.YANDEX_CLOUD_FOLDER_ID?.trim()
  if (!folder) throw new Error('program_model_unconfigured')
  const token = await programIamToken()
  const modelUri = `gpt://${folder}/${process.env.YANDEX_CLOUD_MODEL_ID ?? 'yandexgpt'}/latest`
  const response = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ modelUri, completionOptions: { stream: false, temperature: 0.1, maxTokens: String(input.maxTokens) },
      jsonSchema: { schema: input.schema }, messages: [
        { role: 'system', text: input.instruction },
        { role: 'user', text: JSON.stringify(input.data) },
      ],
    }),
  })
  if (!response.ok) throw new Error(`program_model_http_${response.status}`)
  const payload = await response.json() as { result?: { alternatives?: { message?: { text?: string }; status?: string }[]; usage?: unknown } }
  if (input.onUsage) input.onUsage(payload.result?.usage, modelUri, response.headers.get('x-request-id'))
  else await reportAiStudioMetric({ functionName: input.functionName, modelUri, invocationId: input.operationId,
    iamToken: token, upstreamRequestId: response.headers.get('x-request-id'), usage: aiStudioUsage(payload.result?.usage) })
  const result = payload.result?.alternatives?.[0]
  if (!result?.message?.text || result.status === 'ALTERNATIVE_STATUS_TRUNCATED_FINAL') throw new Error('program_model_incomplete')
  return JSON.parse(result.message.text) as unknown
}

export function isProgramPilotEnabled(userId: string): boolean {
  const allowlist = (process.env.ASSISTANT_PROGRAM_PILOT_USER_IDS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
  return process.env.ASSISTANT_PROGRAM_ENABLED === 'true' && allowlist.length === 1 && allowlist[0] === userId
}
