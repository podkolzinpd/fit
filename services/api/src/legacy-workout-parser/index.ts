import { createClient } from '@supabase/supabase-js'

const completionUrl = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion'

type Exercise = { source: 'system' | 'custom'; ref: string; name: string; inputKind: string }
type WorkoutSet = { weightKg?: number; reps?: number; durationMin?: number; distanceKm?: number }
type Item = { sourceText: string; exerciseRef: string; confidence: number; sets: WorkoutSet[] }
type Unmatched = { sourceText: string; reason: string; suggestedExerciseRefs: string[] }

const schema = {
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

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new HttpError(500, `missing_${name.toLowerCase()}`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveSetValue(key: string, value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && (key === 'weightKg' ? value >= 0 : value > 0)
}

function validate(value: unknown, catalog: Exercise[]): { items: Item[]; unmatched: Unmatched[] } {
  if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.unmatched)) throw new HttpError(502, 'invalid_output')
  const allowed = new Set(catalog.map(({ ref }) => ref))
  const items = value.items.flatMap((raw): Item[] => {
    if (!isRecord(raw) || typeof raw.sourceText !== 'string' || typeof raw.exerciseRef !== 'string' || !allowed.has(raw.exerciseRef) || !Array.isArray(raw.sets)) return []
    const sets = raw.sets.filter(isRecord).map((set) => Object.fromEntries(
      ['weightKg', 'reps', 'durationMin', 'distanceKm'].flatMap((key) => isPositiveSetValue(key, set[key]) ? [[key, set[key]]] : []),
    ) as WorkoutSet)
    return [{ sourceText: raw.sourceText.trim(), exerciseRef: raw.exerciseRef, confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0, sets }]
  })
  const unmatched = value.unmatched.flatMap((raw): Unmatched[] => isRecord(raw) && typeof raw.sourceText === 'string'
    ? [{ sourceText: raw.sourceText.trim(), reason: typeof raw.reason === 'string' ? raw.reason.trim() : 'Не найдено в каталоге', suggestedExerciseRefs: Array.isArray(raw.suggestedExerciseRefs) ? raw.suggestedExerciseRefs.filter((ref): ref is string => typeof ref === 'string' && allowed.has(ref)).slice(0, 4) : [] }]
    : [])
  return { items, unmatched }
}

export async function parseWorkout(request: Request): Promise<Response> {
  try {
    const authorization = request.headers.get('authorization')
    if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'unauthorized')
    const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_PUBLISHABLE_KEY'), { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new HttpError(401, 'unauthorized')
    const body = await request.json() as { text?: unknown; systemCatalog?: unknown }
    if (typeof body.text !== 'string' || !Array.isArray(body.systemCatalog) || body.text.length > 12000) throw new HttpError(400, 'invalid_request')
    const system = body.systemCatalog.flatMap((raw): Exercise[] => isRecord(raw) && raw.source === 'system' && typeof raw.ref === 'string' && typeof raw.name === 'string' && typeof raw.inputKind === 'string' ? [{ source: 'system', ref: raw.ref, name: raw.name, inputKind: raw.inputKind }] : [])
    const { data: customs, error } = await supabase.from('custom_exercises').select('id,name,input_kind,archived_at').is('archived_at', null)
    if (error) throw new HttpError(500, 'custom_exercises_lookup_failed')
    const custom = (customs ?? []).flatMap((raw): Exercise[] => typeof raw.id === 'string' && typeof raw.name === 'string' && typeof raw.input_kind === 'string' ? [{ source: 'custom', ref: raw.id, name: raw.name, inputKind: raw.input_kind }] : [])
    const catalog = [...system, ...custom]
    if (!catalog.length) throw new HttpError(400, 'empty_catalog')
    const prompt = ['Разбери запись тренировки после диктовки. Сам раздели слитую речь на упражнения, исправь спортивные оговорки и выбери только существующие упражнения из каталога. Для каждого понятного упражнения верни item с подходами. Если сказано N подходов, верни N одинаковых объектов в sets. Не придумывай значения; неизвестное верни unmatched. Верни JSON строго по schema.', `Текст: ${body.text}`, `Каталог: ${JSON.stringify(catalog)}`].join('\n')
    const response = await fetch(completionUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Api-Key ${required('YANDEX_CLOUD_API_KEY')}` }, body: JSON.stringify({ modelUri: `gpt://${required('YANDEX_CLOUD_FOLDER_ID')}/${process.env.YANDEX_CLOUD_MODEL_ID ?? 'yandexgpt'}/latest`, completionOptions: { stream: false, temperature: 0, maxTokens: '2000' }, jsonSchema: { schema }, messages: [{ role: 'user', text: prompt }] }) })
    if (!response.ok) throw new HttpError(502, 'llm_unavailable')
    const payload = await response.json() as { result?: { alternatives?: Array<{ message?: { text?: string } }> } }
    const result = validate(JSON.parse(payload.result?.alternatives?.[0]?.message?.text ?? ''), catalog)
    console.log(JSON.stringify({ event: 'workout_parse_completed', userPresent: true, items: result.items.length, unmatched: result.unmatched.length }))
    return Response.json(result)
  } catch (error) {
    const known = error instanceof HttpError ? error : new HttpError(502, 'parse_failed')
    console.error(JSON.stringify({ event: 'workout_parse_failed', code: known.code, status: known.status }))
    return Response.json({ error: { code: known.code, message: 'Не удалось разобрать диктовку' } }, { status: known.status })
  }
}
