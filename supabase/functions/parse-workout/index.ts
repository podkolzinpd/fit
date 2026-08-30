import "jsr:@supabase/functions-js@^2/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2.110.8"

const URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { ...CORS, "Content-Type": "application/json" } })

type Exercise = { source: "system" | "custom"; ref: string; name: string; inputKind: string }
type Item = { sourceText: string; exerciseRef: string; confidence: number; sets: Array<{ weightKg?: number; reps?: number; durationMin?: number; distanceKm?: number }> }
type Unmatched = { sourceText: string; reason: string; suggestedExerciseRefs: string[] }

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "unmatched"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceText", "exerciseRef", "confidence", "sets"],
        properties: {
          sourceText: { type: "string" },
          exerciseRef: { type: "string" },
          confidence: { type: "number" },
          sets: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                weightKg: { type: "number" },
                reps: { type: "number" },
                durationMin: { type: "number" },
                distanceKm: { type: "number" },
              },
            },
          },
        },
      },
    },
    unmatched: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceText", "reason", "suggestedExerciseRefs"],
        properties: {
          sourceText: { type: "string" },
          reason: { type: "string" },
          suggestedExerciseRefs: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
}

const GOAL_OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["criteria", "needsInput", "unsupportedReason"], properties: {
    criteria: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false,
      required: ["metric", "operation", "targetValue", "rangeMin", "rangeMax", "unit", "secondaryTargetValue", "secondaryUnit", "exerciseRef", "customMetricId", "regularityPeriod", "regularityMode"],
      properties: {
        metric: { type: "string" }, operation: { type: "string" }, targetValue: { type: ["number", "null"] }, rangeMin: { type: ["number", "null"] }, rangeMax: { type: ["number", "null"] }, unit: { type: "string" },
        secondaryTargetValue: { type: ["number", "null"] }, secondaryUnit: { type: ["string", "null"] }, exerciseRef: { type: ["string", "null"] }, customMetricId: { type: ["string", "null"] }, regularityPeriod: { type: ["string", "null"] }, regularityMode: { type: ["string", "null"] },
      } } },
    needsInput: { type: "array", items: { type: "object", additionalProperties: false, required: ["message", "exerciseRefs"], properties: { message: { type: "string" }, exerciseRefs: { type: "array", maxItems: 4, items: { type: "string" } } } } },
    unsupportedReason: { type: ["string", "null"] },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function isSetValue(key: string, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false
  return key === "weightKg" ? value >= 0 : value > 0
}
function validate(value: unknown, catalog: Exercise[]): { items: Item[]; unmatched: Unmatched[] } {
  if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.unmatched)) throw new Error("invalid_output")
  const allowed = new Set(catalog.map((item) => item.ref))
  const items = value.items.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.sourceText !== "string" || typeof raw.exerciseRef !== "string" || !allowed.has(raw.exerciseRef) || !Array.isArray(raw.sets)) return []
    const sets = raw.sets.filter(isRecord).map((set) => Object.fromEntries(["weightKg", "reps", "durationMin", "distanceKm"].flatMap((key) => isSetValue(key, set[key]) ? [[key, set[key]]] : [])))
    return [{ sourceText: raw.sourceText.trim(), exerciseRef: raw.exerciseRef, confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0, sets }]
  })
  const unmatched = value.unmatched.flatMap((raw) => isRecord(raw) && typeof raw.sourceText === "string" ? [{ sourceText: raw.sourceText.trim(), reason: typeof raw.reason === "string" ? raw.reason.trim() : "Не найдено в каталоге", suggestedExerciseRefs: Array.isArray(raw.suggestedExerciseRefs) ? raw.suggestedExerciseRefs.filter((ref): ref is string => typeof ref === "string" && allowed.has(ref)).slice(0, 4) : [] }] : [])
  return { items, unmatched }
}

function validateGoal(value: unknown, catalog: Exercise[], metrics: Array<{ id: string }>) {
  if (!isRecord(value) || !Array.isArray(value.criteria) || !Array.isArray(value.needsInput) || value.criteria.length > 10 || !(value.unsupportedReason === null || typeof value.unsupportedReason === "string")) throw new Error("invalid_output")
  const refs = new Set(catalog.map((item) => item.ref)); const metricIds = new Set(metrics.map((item) => item.id))
  const allowedMetrics = new Set(["weight", "waist", "chest", "hips", "exercise_working_weight", "exercise_reps", "exercise_volume", "exercise_best_result", "cardio_distance", "cardio_duration", "cardio_pace", "cardio_distance_time", "workout_regularity", "custom"])
  const allowedOperations = new Set(["decrease_to", "increase_to", "maintain_range", "change_by", "track_only"])
  const criteria = value.criteria.map((raw) => { if (!isRecord(raw) || typeof raw.metric !== "string" || !allowedMetrics.has(raw.metric) || typeof raw.operation !== "string" || !allowedOperations.has(raw.operation) || typeof raw.unit !== "string") throw new Error("invalid_output"); if ((raw.metric.startsWith("exercise_") || raw.metric.startsWith("cardio_")) && (typeof raw.exerciseRef !== "string" || !refs.has(raw.exerciseRef))) throw new Error("invalid_output"); if (raw.metric === "custom" && (typeof raw.customMetricId !== "string" || !metricIds.has(raw.customMetricId))) throw new Error("invalid_output"); return raw })
  const needsInput = value.needsInput.map((raw) => { if (!isRecord(raw) || typeof raw.message !== "string" || !Array.isArray(raw.exerciseRefs)) throw new Error("invalid_output"); return { message: raw.message.trim(), exerciseRefs: raw.exerciseRefs.filter((ref): ref is string => typeof ref === "string" && refs.has(ref)).slice(0, 4) } })
  return { criteria, needsInput, unsupportedReason: value.unsupportedReason }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS })
  try {
    const auth = request.headers.get("Authorization")
    if (!auth) return json({ error: "unauthorized" }, 401)
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: "unauthorized" }, 401)
    const body = await request.json() as { kind?: unknown; text?: unknown; systemCatalog?: unknown }
    if (typeof body.text !== "string" || !Array.isArray(body.systemCatalog) || body.text.length > 12000) return json({ error: { code: "invalid_request", message: "Некорректный запрос разбора тренировки" } }, 400)
    const { data: customs, error: customsError } = await supabase.from("custom_exercises").select("id,name,input_kind,archived_at").is("archived_at", null)
    if (customsError) throw customsError
    const system = body.systemCatalog.flatMap((raw): Exercise[] => isRecord(raw) && raw.source === "system" && typeof raw.ref === "string" && typeof raw.name === "string" && typeof raw.inputKind === "string" ? [{ source: "system", ref: raw.ref, name: raw.name, inputKind: raw.inputKind }] : [])
    const custom = (customs ?? []).flatMap((raw): Exercise[] => typeof raw.id === "string" && typeof raw.name === "string" && typeof raw.input_kind === "string" ? [{ source: "custom", ref: raw.id, name: raw.name, inputKind: raw.input_kind }] : [])
    const catalog = [...system, ...custom]
    if (!catalog.length) return json({ error: { code: "empty_catalog", message: "Каталог упражнений пуст" } }, 400)
    const goalMode = body.kind === "goal_criteria"
    const { data: metrics, error: metricsError } = goalMode ? await supabase.from("client_custom_metrics").select("id,name,unit").is("archived_at", null) : { data: [], error: null }
    if (metricsError) throw metricsError
    const prompt = goalMode ? [
      "Предложи измеримые критерии для цели фитнес-клиента. Ты только предлагаешь настройку: не вычисляй прогресс, статус или направление. Верни до 10 критериев строго по schema. Используй только перечисленные metric и operation. Для упражнения используй только точный exerciseRef из каталога. Если упражнение неоднозначно — не создавай критерий, добавь needsInput с кандидатами. Для регулярности различай average и each_period. Пользовательский показатель выбирай только по id. Название нового показателя само по себе не задаёт направление. Медицинские формулировки, нереалистичные числа, пропущенные единицы и неподдерживаемые цели не додумывай: верни needsInput или unsupportedReason. Поля, которые не относятся к критерию, должны быть null.",
      "Цель: " + body.text, "Каталог: " + JSON.stringify(catalog), "Пользовательские показатели: " + JSON.stringify(metrics),
    ].join("\n") : [
      "Разбери запись тренировки после диктовки. Сам раздели слитую речь на упражнения, исправь спортивные оговорки и выбери только существующие упражнения из каталога. Для каждого понятного упражнения верни item с подходами. Если сказано N подходов (например, «3 подхода по 15 на 100», «15 повторений, 3 подхода, 100 кг» или «3 по 15 на 100»), верни N одинаковых объектов в sets. Порядок чисел в речи не важен. Не придумывай значения: включай в set только явно названные метрики; не добавляй нули для отсутствующих повторов, веса, времени или дистанции. Для неизвестного верни unmatched и до 4 близких ref из каталога. Не объединяй упражнения. Верни JSON строго по schema.",
      "Текст: " + body.text,
      "Каталог: " + JSON.stringify(catalog),
    ].join("\n")
    const apiKey = Deno.env.get("YANDEX_CLOUD_API_KEY")
    const folderId = Deno.env.get("YANDEX_CLOUD_FOLDER_ID")
    if (!apiKey || !folderId) throw new Error("missing_yandex_cloud_credentials")
    const modelId = Deno.env.get("YANDEX_CLOUD_MODEL_ID") ?? "yandexgpt"
    const modelUri = `gpt://${folderId}/${modelId}/latest`
    for (let attempt = 1; attempt <= 2; attempt++) {
      let response: Response
      try {
        response = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Api-Key " + apiKey }, body: JSON.stringify({ modelUri, completionOptions: { stream: false, temperature: 0, maxTokens: "2000" }, jsonSchema: { schema: goalMode ? GOAL_OUTPUT_SCHEMA : OUTPUT_SCHEMA }, messages: [{ role: "user", text: prompt }] }) })
      } catch (error) {
        console.error(JSON.stringify({ event: "workout_parse_llm_network_error", attempt, message: error instanceof Error ? error.message : "unknown" }))
        if (attempt === 2) throw error
        continue
      }
      if (!response.ok) {
        console.error(JSON.stringify({ event: "workout_parse_llm_error", attempt, status: response.status }))
        if (response.status >= 500 && attempt < 2) continue
        return json({ error: { code: "llm_unavailable", message: "Модель разбора временно недоступна" } }, 502)
      }
      try {
        const payload = await response.json() as { result?: { alternatives?: Array<{ message?: { text?: string } }> } }
        const result = goalMode ? validateGoal(JSON.parse(payload.result?.alternatives?.[0]?.message?.text ?? ""), catalog, metrics ?? []) : validate(JSON.parse(payload.result?.alternatives?.[0]?.message?.text ?? ""), catalog)
        console.log(JSON.stringify({ event: goalMode ? "goal_criteria_suggested" : "workout_parse_completed", attempt }))
        return json(result)
      } catch (error) {
        console.error(JSON.stringify({ event: "workout_parse_invalid_response", attempt, message: error instanceof Error ? error.message : "unknown" }))
        if (attempt === 2) throw error
      }
    }
    throw new Error("workout_parse_retry_exhausted")
  } catch (error) {
    console.error(JSON.stringify({ event: "workout_parse_failed", message: error instanceof Error ? error.message : "unknown" }))
    return json({ error: { code: "parse_failed", message: "Не удалось разобрать диктовку" } }, 502)
  }
})
