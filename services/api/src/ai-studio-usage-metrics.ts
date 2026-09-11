const METRICS_ENDPOINT = 'https://monitoring.api.cloud.yandex.net/monitoring/v2/data/write'
type UnknownRecord = Record<string, unknown>

type Metric = {
  name: string
  type: 'DGAUGE' | 'IGAUGE'
  value: number
}

export type AiStudioUsage = {
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  totalTokens: number
}

export type AiStudioMetricEvent = {
  functionName: string
  modelUri: string
  invocationId: string | null
  iamToken: string | null
  upstreamRequestId: string | null
  usage: AiStudioUsage | null
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokenCount(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function firstTokenCount(record: UnknownRecord, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = tokenCount(record[key])
    if (value !== undefined) return value
  }
  return undefined
}

/** Normalizes both legacy completion API and Responses API usage payloads. */
export function aiStudioUsage(value: unknown): AiStudioUsage | null {
  if (!isRecord(value)) return null
  const inputDetails = isRecord(value.inputTokenDetails)
    ? value.inputTokenDetails
    : isRecord(value.input_tokens_details) ? value.input_tokens_details : {}
  const input = firstTokenCount(value, ['inputTextTokens', 'input_tokens']) ?? 0
  const output = firstTokenCount(value, ['completionTokens', 'outputTokens', 'output_tokens']) ?? 0
  const total = firstTokenCount(value, ['totalTokens', 'total_tokens']) ?? input + output
  const explicitCached = firstTokenCount(value, ['cachedTokens', 'cached_tokens'])
    ?? firstTokenCount(inputDetails, ['cachedTokens', 'cached_tokens'])
  const cached = explicitCached ?? Math.max(0, total - input - output)
  return { inputTokens: input, cachedTokens: cached, outputTokens: output, totalTokens: total }
}

function modelLabel(modelUri: string): string {
  const value = modelUri.split('/').filter(Boolean).at(-2) ?? modelUri
  return value.slice(0, 64) || 'unknown'
}

function costRub(totalTokens: number): number {
  const configured = Number(process.env.AI_STUDIO_RUB_PER_1K_TOKENS ?? '1.2')
  const rate = Number.isFinite(configured) && configured >= 0 ? configured : 1.2
  return totalTokens * rate / 1_000
}

function metrics(event: AiStudioMetricEvent): Metric[] {
  const usage = event.usage
  if (usage === null) return [{ name: 'ai_studio_model_calls', type: 'IGAUGE', value: 1 }]
  return [
    { name: 'ai_studio_model_calls', type: 'IGAUGE', value: 1 },
    { name: 'ai_studio_input_tokens', type: 'IGAUGE', value: usage.inputTokens },
    { name: 'ai_studio_cached_tokens', type: 'IGAUGE', value: usage.cachedTokens },
    { name: 'ai_studio_output_tokens', type: 'IGAUGE', value: usage.outputTokens },
    { name: 'ai_studio_total_tokens', type: 'IGAUGE', value: usage.totalTokens },
    { name: 'ai_studio_cost_rub', type: 'DGAUGE', value: costRub(usage.totalTokens) },
  ]
}

/**
 * Writes aggregate-safe metrics and logs the invocation ID for correlation.
 * Invocation IDs intentionally are not metric labels: they are unbounded.
 */
export async function reportAiStudioMetric(event: AiStudioMetricEvent): Promise<void> {
  const folderId = process.env.YANDEX_CLOUD_FOLDER_ID
  if (!folderId || !event.iamToken) return
  try {
    const response = await fetch(`${METRICS_ENDPOINT}?folderId=${encodeURIComponent(folderId)}&service=custom`, {
      method: 'POST',
      headers: { authorization: `Bearer ${event.iamToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        labels: { function_name: event.functionName, model_id: modelLabel(event.modelUri) },
        metrics: metrics(event),
      }),
    })
    if (!response.ok) throw new Error(`monitoring_write_${response.status}`)
    console.info('ai_studio_model_usage', {
      function_name: event.functionName,
      invocation_id: event.invocationId,
      upstream_request_id: event.upstreamRequestId,
      model_id: modelLabel(event.modelUri),
      usage: event.usage,
    })
  } catch (error) {
    console.warn('ai_studio_metric_write_failed', {
      function_name: event.functionName,
      invocation_id: event.invocationId,
      code: error instanceof Error ? error.message : 'unknown',
    })
  }
}
