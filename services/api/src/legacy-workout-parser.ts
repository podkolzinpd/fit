import { SupabaseBridge, SupabaseBridgeError } from './supabase-bridge.js'
import {
  ApiKeyYandexAiAuthorization,
  type YandexAiAuthorization,
} from './yandex-ai-authorization.js'
import {
  matchWorkoutExtraction,
  readSystemExercise,
  validateWorkoutExtraction,
  workoutExtractionPrompt,
  workoutExtractionSchema,
  type WorkoutParseResponse,
  type WorkoutParserExercise,
} from './legacy-workout-parser/extracted-workout.js'
import { invokeYandexLlmCompletion } from './yandex-llm-function-client.js'

export type { WorkoutParseResponse, WorkoutParserExercise } from './legacy-workout-parser/extracted-workout.js'

const completionUrl = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion'

export type GoalCriteriaSuggestionResponse = { criteria: Record<string, unknown>[]; needsInput: Array<{ message: string; exerciseRefs: string[] }>; unsupportedReason: string | null }

export class WorkoutParseError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

const goalOutputSchema = {
  type: 'object', additionalProperties: false, required: ['criteria', 'needsInput', 'unsupportedReason'], properties: {
    criteria: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false,
      required: ['metric', 'operation', 'targetValue', 'rangeMin', 'rangeMax', 'unit', 'secondaryTargetValue', 'secondaryUnit', 'exerciseRef', 'customMetricId', 'regularityPeriod', 'regularityMode'],
      properties: {
        metric: { type: 'string' }, operation: { type: 'string' }, targetValue: { type: ['number', 'null'] },
        rangeMin: { type: ['number', 'null'] }, rangeMax: { type: ['number', 'null'] }, unit: { type: 'string' },
        secondaryTargetValue: { type: ['number', 'null'] }, secondaryUnit: { type: ['string', 'null'] },
        exerciseRef: { type: ['string', 'null'] }, customMetricId: { type: ['string', 'null'] },
        regularityPeriod: { type: ['string', 'null'] }, regularityMode: { type: ['string', 'null'] },
      } },
    },
    needsInput: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['message', 'exerciseRefs'], properties: {
      message: { type: 'string' }, exerciseRefs: { type: 'array', maxItems: 4, items: { type: 'string' } },
    } } },
    unsupportedReason: { type: ['string', 'null'] },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateGoalSuggestion(value: unknown, catalog: WorkoutParserExercise[], customMetrics: Array<{ id: string }>): GoalCriteriaSuggestionResponse {
  if (!isRecord(value) || !Array.isArray(value.criteria) || !Array.isArray(value.needsInput)
    || !(value.unsupportedReason === null || typeof value.unsupportedReason === 'string') || value.criteria.length > 10) throw new Error('invalid_output')
  const refs = new Set(catalog.map((item) => item.ref))
  const metricIds = new Set(customMetrics.map((item) => item.id))
  const metrics = new Set(['weight', 'waist', 'chest', 'hips', 'exercise_working_weight', 'exercise_reps', 'exercise_volume', 'exercise_best_result', 'cardio_distance', 'cardio_duration', 'cardio_pace', 'cardio_distance_time', 'workout_regularity', 'custom'])
  const operations = new Set(['decrease_to', 'increase_to', 'maintain_range', 'change_by', 'track_only'])
  const criteria = value.criteria.map((raw) => {
    if (!isRecord(raw) || typeof raw.metric !== 'string' || !metrics.has(raw.metric)
      || typeof raw.operation !== 'string' || !operations.has(raw.operation)
      || typeof raw.unit !== 'string') throw new Error('invalid_output')
    if ((raw.metric.startsWith('exercise_') || raw.metric.startsWith('cardio_'))
      && (typeof raw.exerciseRef !== 'string' || !refs.has(raw.exerciseRef))) throw new Error('invalid_output')
    if (raw.metric === 'custom' && (typeof raw.customMetricId !== 'string' || !metricIds.has(raw.customMetricId))) throw new Error('invalid_output')
    return raw
  })
  const needsInput = value.needsInput.map((raw) => {
    if (!isRecord(raw) || typeof raw.message !== 'string' || !Array.isArray(raw.exerciseRefs)) throw new Error('invalid_output')
    return { message: raw.message.trim(), exerciseRefs: raw.exerciseRefs.filter((ref): ref is string => typeof ref === 'string' && refs.has(ref)).slice(0, 4) }
  })
  return { criteria, needsInput, unsupportedReason: value.unsupportedReason }
}

export interface LegacyWorkoutParser {
  parse(actorToken: string, value: unknown): Promise<WorkoutParseResponse>
  suggest?(actorToken: string, value: unknown): Promise<GoalCriteriaSuggestionResponse>
}

export class YandexWorkoutParser {
  private readonly authorization: YandexAiAuthorization

  constructor(
    authorization: string | YandexAiAuthorization,
    private readonly yandexFolderId: string,
    private readonly modelId = 'yandexgpt',
    private readonly request = fetch,
  ) {
    this.authorization = typeof authorization === 'string'
      ? new ApiKeyYandexAiAuthorization(authorization)
      : authorization
  }

  async parse(value: unknown, customCatalog: readonly WorkoutParserExercise[] = []): Promise<WorkoutParseResponse> {
    const input = this.parseInput(value)
    const system = input.systemCatalog.flatMap((raw): WorkoutParserExercise[] => {
      const exercise = readSystemExercise(raw)
      return exercise ? [exercise] : []
    })
    const custom = customCatalog.filter((item) => item.source === 'custom')
    const catalog = [...system, ...custom]
    if (catalog.length === 0) throw new WorkoutParseError(400, 'empty_catalog')
    const prompt = workoutExtractionPrompt(input.text)
    const startedAt = Date.now()
    let response: Response
    try {
      const requestBody = { modelUri: `gpt://${this.yandexFolderId}/${this.modelId}/latest`, completionOptions: { stream: false, temperature: 0, maxTokens: '1200' }, jsonSchema: { schema: workoutExtractionSchema }, messages: [{ role: 'user', text: prompt }] }
      if (process.env.YANDEX_LLM_FUNCTION_URL && process.env.YANDEX_LLM_GATEWAY_PRIVATE_KEY) {
        const result = await invokeYandexLlmCompletion(requestBody, 90_000, this.request)
        response = new Response(JSON.stringify(result.payload), { status: 200, headers: { 'x-request-id': result.requestId ?? '' } })
      } else response = await this.request(completionUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: await this.authorization.authorizationHeader() }, body: JSON.stringify(requestBody) })
    } catch {
      console.error(JSON.stringify({ event: 'workout_parse_llm_network_error', modelCallCount: 1, catalogCount: catalog.length, promptBytes: Buffer.byteLength(prompt) }))
      throw new WorkoutParseError(502, 'llm_unavailable')
    }
    if (!response.ok) {
      console.error(JSON.stringify({ event: 'workout_parse_llm_error', modelCallCount: 1, status: response.status, catalogCount: catalog.length, promptBytes: Buffer.byteLength(prompt) }))
      throw new WorkoutParseError(502, 'llm_unavailable')
    }
    try {
      const payload = await response.json() as { result?: { alternatives?: Array<{ message?: { text?: string } }>; usage?: unknown } }
      const extracted = validateWorkoutExtraction(JSON.parse(payload.result?.alternatives?.[0]?.message?.text ?? ''))
      const result = matchWorkoutExtraction(extracted, catalog)
      console.log(JSON.stringify({
        event: 'workout_parse_completed', modelCallCount: 1, durationMs: Date.now() - startedAt,
        inputLineCount: input.text.split('\n').filter(Boolean).length,
        catalogCount: catalog.length, promptBytes: Buffer.byteLength(prompt), usage: payload.result?.usage ?? null,
        extractedCount: extracted.items.length, matchedCount: result.items.length, unmatchedCount: result.unmatched.length,
        ambiguousCount: result.unmatched.filter((item) => item.suggestedExerciseRefs.length > 1).length,
      }))
      return result
    } catch {
      console.error(JSON.stringify({ event: 'workout_parse_invalid_response', modelCallCount: 1, catalogCount: catalog.length, promptBytes: Buffer.byteLength(prompt) }))
      throw new WorkoutParseError(502, 'parse_failed')
    }
  }

  async suggest(value: unknown, customCatalog: readonly WorkoutParserExercise[] = [], customMetrics: Array<{ id: string; name: string; unit: string | null }> = []): Promise<GoalCriteriaSuggestionResponse> {
    const input = this.parseInput(value)
    const system = input.systemCatalog.flatMap((raw): WorkoutParserExercise[] => {
      const exercise = readSystemExercise(raw)
      return exercise ? [exercise] : []
    })
    const catalog = [...system, ...customCatalog.filter((item) => item.source === 'custom')]
    const prompt = [
      'Предложи измеримые критерии для цели фитнес-клиента. Ты только предлагаешь настройку: не вычисляй прогресс, статус или направление. Верни до 10 критериев строго по schema. Используй только перечисленные metric и operation. Для упражнения используй только точный exerciseRef из каталога. Если упражнение неоднозначно — не создавай критерий, добавь needsInput с кандидатами. Для регулярности различай average и each_period. Пользовательский показатель выбирай только по id. Название нового показателя само по себе не задаёт направление. Медицинские формулировки, нереалистичные числа, пропущенные единицы и неподдерживаемые цели не додумывай: верни needsInput или unsupportedReason. Поля, которые не относятся к критерию, должны быть null.',
      `Цель: ${input.text}`,
      `Каталог: ${JSON.stringify(catalog)}`,
      `Пользовательские показатели: ${JSON.stringify(customMetrics)}`,
    ].join('\n')
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const requestBody = { modelUri: `gpt://${this.yandexFolderId}/${this.modelId}/latest`, completionOptions: { stream: false, temperature: 0, maxTokens: '2000' }, jsonSchema: { schema: goalOutputSchema }, messages: [{ role: 'user', text: prompt }] }
        const response = process.env.YANDEX_LLM_FUNCTION_URL && process.env.YANDEX_LLM_GATEWAY_PRIVATE_KEY
          ? new Response(JSON.stringify((await invokeYandexLlmCompletion(requestBody, 90_000, this.request)).payload), { status: 200 })
          : await this.request(completionUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: await this.authorization.authorizationHeader() }, body: JSON.stringify(requestBody) })
        if (!response.ok) {
          if (response.status >= 500 && attempt < 2) continue
          throw new WorkoutParseError(502, 'llm_unavailable')
        }
        const payload = await response.json() as { result?: { alternatives?: Array<{ message?: { text?: string } }> } }
        return validateGoalSuggestion(JSON.parse(payload.result?.alternatives?.[0]?.message?.text ?? ''), catalog, customMetrics)
      } catch (error) {
        if (error instanceof WorkoutParseError) throw error
        if (attempt === 2) throw new WorkoutParseError(502, 'parse_failed')
      }
    }
    throw new WorkoutParseError(502, 'parse_failed')
  }

  private parseInput(value: unknown): { text: string; systemCatalog: unknown[] } {
    if (!isRecord(value) || typeof value.text !== 'string' || !value.text.trim()
      || !Array.isArray(value.systemCatalog) || value.text.length > 12_000) {
      throw new WorkoutParseError(400, 'invalid_request')
    }
    return { text: value.text, systemCatalog: value.systemCatalog }
  }
}

export class SupabaseWorkoutParser implements LegacyWorkoutParser {
  constructor(
    private readonly supabase: SupabaseBridge,
    private readonly yandexApiKey: string,
    private readonly yandexFolderId: string,
    private readonly modelId = 'yandexgpt',
    private readonly request = fetch,
  ) {}

  async parse(actorToken: string, value: unknown): Promise<WorkoutParseResponse> {
    const userId = await this.supabase.authenticatedUserId(actorToken)
    if (userId === undefined) throw new WorkoutParseError(401, 'unauthorized')
    let customs: Array<{ id: string; name: string; input_kind: string }>
    try {
      customs = await this.supabase.select('custom_exercises?select=id,name,input_kind,archived_at&archived_at=is.null', actorToken)
    } catch (error) {
      if (error instanceof SupabaseBridgeError && error.status === 503) throw new WorkoutParseError(503, 'supabase_unavailable')
      throw new WorkoutParseError(502, 'parse_failed')
    }
    const custom = customs.flatMap((raw): WorkoutParserExercise[] =>
      typeof raw.id === 'string' && typeof raw.name === 'string' && typeof raw.input_kind === 'string'
        ? [{ source: 'custom', ref: raw.id, name: raw.name, inputKind: raw.input_kind }]
        : [])
    return new YandexWorkoutParser(
      this.yandexApiKey,
      this.yandexFolderId,
      this.modelId,
      this.request,
    ).parse(value, custom)
  }

  async suggest(actorToken: string, value: unknown): Promise<GoalCriteriaSuggestionResponse> {
    const userId = await this.supabase.authenticatedUserId(actorToken)
    if (userId === undefined) throw new WorkoutParseError(401, 'unauthorized')
    try {
      const [customExercises, customMetrics] = await Promise.all([
        this.supabase.select<Array<{ id: string; name: string; input_kind: string }>>('custom_exercises?select=id,name,input_kind,archived_at&archived_at=is.null', actorToken),
        this.supabase.select<Array<{ id: string; name: string; unit: string | null }>>('client_custom_metrics?select=id,name,unit,archived_at&archived_at=is.null', actorToken),
      ])
      const custom = customExercises.map((raw) => ({ source: 'custom' as const, ref: raw.id, name: raw.name, inputKind: raw.input_kind }))
      return new YandexWorkoutParser(this.yandexApiKey, this.yandexFolderId, this.modelId, this.request).suggest(value, custom, customMetrics)
    } catch (error) {
      if (error instanceof WorkoutParseError) throw error
      if (error instanceof SupabaseBridgeError && error.status === 503) throw new WorkoutParseError(503, 'supabase_unavailable')
      throw new WorkoutParseError(502, 'parse_failed')
    }
  }
}
