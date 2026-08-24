import { SupabaseBridge, SupabaseBridgeError } from './supabase-bridge.js'

const completionUrl = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion'

type Exercise = { source: 'system' | 'custom'; ref: string; name: string; inputKind: string }
type ParsedItem = { sourceText: string; exerciseRef: string; confidence: number; sets: Array<{ weightKg?: number; reps?: number; durationMin?: number; distanceKm?: number }> }
type Unmatched = { sourceText: string; reason: string; suggestedExerciseRefs: string[] }

export type WorkoutParseResponse = { items: ParsedItem[]; unmatched: Unmatched[] }

export class WorkoutParseError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

const outputSchema = {
  type: 'object', additionalProperties: false, required: ['items', 'unmatched'], properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sourceText', 'exerciseRef', 'confidence', 'sets'], properties: {
      sourceText: { type: 'string' }, exerciseRef: { type: 'string' }, confidence: { type: 'number' },
      sets: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        weightKg: { type: 'number' }, reps: { type: 'number' }, durationMin: { type: 'number' }, distanceKm: { type: 'number' },
      } } },
    } } },
    unmatched: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sourceText', 'reason', 'suggestedExerciseRefs'], properties: {
      sourceText: { type: 'string' }, reason: { type: 'string' }, suggestedExerciseRefs: { type: 'array', items: { type: 'string' } },
    } } },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSetValue(key: string, value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && (key === 'weightKg' ? value >= 0 : value > 0)
}

function validate(value: unknown, catalog: Exercise[]): WorkoutParseResponse {
  if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.unmatched)) throw new Error('invalid_output')
  const allowed = new Set(catalog.map((item) => item.ref))
  const items = value.items.flatMap((raw): ParsedItem[] => {
    if (!isRecord(raw) || typeof raw.sourceText !== 'string' || typeof raw.exerciseRef !== 'string' || !allowed.has(raw.exerciseRef) || !Array.isArray(raw.sets)) return []
    const sets = raw.sets.filter(isRecord).map((set) => Object.fromEntries(
      ['weightKg', 'reps', 'durationMin', 'distanceKm'].flatMap((key) => isSetValue(key, set[key]) ? [[key, set[key]]] : []),
    ))
    return [{ sourceText: raw.sourceText.trim(), exerciseRef: raw.exerciseRef, confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0, sets }]
  })
  const unmatched = value.unmatched.flatMap((raw): Unmatched[] => isRecord(raw) && typeof raw.sourceText === 'string' ? [{
    sourceText: raw.sourceText.trim(), reason: typeof raw.reason === 'string' ? raw.reason.trim() : 'Не найдено в каталоге',
    suggestedExerciseRefs: Array.isArray(raw.suggestedExerciseRefs) ? raw.suggestedExerciseRefs.filter((ref): ref is string => typeof ref === 'string' && allowed.has(ref)).slice(0, 4) : [],
  }] : [])
  return { items, unmatched }
}

export interface LegacyWorkoutParser {
  parse(actorToken: string, value: unknown): Promise<WorkoutParseResponse>
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
    const input = this.parseInput(value)
    const userId = await this.supabase.authenticatedUserId(actorToken)
    if (userId === undefined) throw new WorkoutParseError(401, 'unauthorized')
    let customs: Array<{ id: string; name: string; input_kind: string }> 
    try {
      customs = await this.supabase.select('custom_exercises?select=id,name,input_kind,archived_at&archived_at=is.null', actorToken)
    } catch (error) {
      if (error instanceof SupabaseBridgeError && error.status === 503) throw new WorkoutParseError(503, 'supabase_unavailable')
      throw new WorkoutParseError(502, 'parse_failed')
    }
    const system = input.systemCatalog.flatMap((raw): Exercise[] => isRecord(raw) && raw.source === 'system' && typeof raw.ref === 'string' && typeof raw.name === 'string' && typeof raw.inputKind === 'string' ? [{ source: 'system', ref: raw.ref, name: raw.name, inputKind: raw.inputKind }] : [])
    const custom = customs.flatMap((raw): Exercise[] => typeof raw.id === 'string' && typeof raw.name === 'string' && typeof raw.input_kind === 'string' ? [{ source: 'custom', ref: raw.id, name: raw.name, inputKind: raw.input_kind }] : [])
    const catalog = [...system, ...custom]
    if (catalog.length === 0) throw new WorkoutParseError(400, 'empty_catalog')
    const prompt = [
      'Разбери запись тренировки после диктовки. Сам раздели слитую речь на упражнения, исправь спортивные оговорки и выбери только существующие упражнения из каталога. Для каждого понятного упражнения верни item с подходами. Если сказано N подходов (например, «3 подхода по 15 на 100», «15 повторений, 3 подхода, 100 кг» или «3 по 15 на 100»), верни N одинаковых объектов в sets. Порядок чисел в речи не важен. Не придумывай значения: включай в set только явно названные метрики; не добавляй нули для отсутствующих повторов, веса, времени или дистанции. Для неизвестного верни unmatched и до 4 близких ref из каталога. Не объединяй упражнения. Верни JSON строго по schema.',
      `Текст: ${input.text}`, `Каталог: ${JSON.stringify(catalog)}`,
    ].join('\n')
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let response: Response
      try {
        response = await this.request(completionUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Api-Key ${this.yandexApiKey}` }, body: JSON.stringify({ modelUri: `gpt://${this.yandexFolderId}/${this.modelId}/latest`, completionOptions: { stream: false, temperature: 0, maxTokens: '2000' }, jsonSchema: { schema: outputSchema }, messages: [{ role: 'user', text: prompt }] }) })
      } catch {
        if (attempt === 2) throw new WorkoutParseError(502, 'parse_failed')
        continue
      }
      if (!response.ok) {
        if (response.status >= 500 && attempt < 2) continue
        throw new WorkoutParseError(502, 'llm_unavailable')
      }
      try {
        const payload = await response.json() as { result?: { alternatives?: Array<{ message?: { text?: string } }> } }
        return validate(JSON.parse(payload.result?.alternatives?.[0]?.message?.text ?? ''), catalog)
      } catch {
        if (attempt === 2) throw new WorkoutParseError(502, 'parse_failed')
      }
    }
    throw new WorkoutParseError(502, 'parse_failed')
  }

  private parseInput(value: unknown): { text: string; systemCatalog: unknown[] } {
    if (!isRecord(value) || typeof value.text !== 'string' || !Array.isArray(value.systemCatalog) || value.text.length > 12_000) {
      throw new WorkoutParseError(400, 'invalid_request')
    }
    return { text: value.text, systemCatalog: value.systemCatalog }
  }
}
