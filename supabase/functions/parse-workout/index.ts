import "jsr:@supabase/functions-js@^2/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2.110.8"

const URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { ...CORS, "Content-Type": "application/json" } })

type Exercise = { source: "system" | "custom"; ref: string; name: string; inputKind: string }
type Item = { sourceText: string; exerciseRef: string; confidence: number; sets: Array<{ weightKg?: number; reps?: number; durationMin?: number; distanceKm?: number }> }
type Unmatched = { sourceText: string; reason: string; suggestedExerciseRefs: string[] }

const OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items", "unmatched"], properties: {
    items: { type: "array", items: { type: "object", additionalProperties: false, required: ["sourceText", "exerciseRef", "confidence", "sets"], properties: {
      sourceText: { type: "string" }, exerciseRef: { type: "string" }, confidence: { type: "number" },
      sets: { type: "array", items: { type: "object", additionalProperties: false, properties: { weightKg: { type: "number" }, reps: { type: "number" }, durationMin: { type: "number" }, distanceKm: { type: "number" } } },
    } } },
    unmatched: { type: "array", items: { type: "object", additionalProperties: false, required: ["sourceText", "reason", "suggestedExerciseRefs"], properties: { sourceText: { type: "string" }, reason: { type: "string" }, suggestedExerciseRefs: { type: "array", items: { type: "string" } } } } },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function validate(value: unknown, catalog: Exercise[]): { items: Item[]; unmatched: Unmatched[] } {
  if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.unmatched)) throw new Error("invalid_output")
  const allowed = new Set(catalog.map((item) => item.ref))
  const items = value.items.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.sourceText !== "string" || typeof raw.exerciseRef !== "string" || !allowed.has(raw.exerciseRef) || !Array.isArray(raw.sets)) return []
    const sets = raw.sets.filter(isRecord).map((set) => Object.fromEntries(["weightKg", "reps", "durationMin", "distanceKm"].flatMap((key) => typeof set[key] === "number" ? [[key, set[key]]] : [])))
    return [{ sourceText: raw.sourceText.trim(), exerciseRef: raw.exerciseRef, confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0, sets }]
  })
  const unmatched = value.unmatched.flatMap((raw) => isRecord(raw) && typeof raw.sourceText === "string" ? [{ sourceText: raw.sourceText.trim(), reason: typeof raw.reason === "string" ? raw.reason.trim() : "Не найдено в каталоге", suggestedExerciseRefs: Array.isArray(raw.suggestedExerciseRefs) ? raw.suggestedExerciseRefs.filter((ref): ref is string => typeof ref === "string" && allowed.has(ref)).slice(0, 4) : [] }] : [])
  return { items, unmatched }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS })
  try {
    const auth = request.headers.get("Authorization")
    if (!auth) return json({ error: "unauthorized" }, 401)
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: "unauthorized" }, 401)
    const body = await request.json() as { text?: unknown; systemCatalog?: unknown }
    if (typeof body.text !== "string" || !Array.isArray(body.systemCatalog) || body.text.length > 12000) return json({ error: { code: "invalid_request", message: "Некорректный запрос разбора тренировки" } }, 400)
    const { data: customs, error: customsError } = await supabase.from("custom_exercises").select("id,name,input_kind,archived_at").is("archived_at", null)
    if (customsError) throw customsError
    const system = body.systemCatalog.flatMap((raw): Exercise[] => isRecord(raw) && raw.source === "system" && typeof raw.ref === "string" && typeof raw.name === "string" && typeof raw.inputKind === "string" ? [{ source: "system", ref: raw.ref, name: raw.name, inputKind: raw.inputKind }] : [])
    const custom = (customs ?? []).flatMap((raw): Exercise[] => typeof raw.id === "string" && typeof raw.name === "string" && typeof raw.input_kind === "string" ? [{ source: "custom", ref: raw.id, name: raw.name, inputKind: raw.input_kind }] : [])
    const catalog = [...system, ...custom]
    if (!catalog.length) return json({ error: { code: "empty_catalog", message: "Каталог упражнений пуст" } }, 400)
    const prompt = [
      "Разбери запись тренировки после диктовки. Сам раздели слитую речь на упражнения, исправь спортивные оговорки и выбери только существующие упражнения из каталога. Для каждого понятного упражнения верни item с подходами. Для неизвестного верни unmatched и до 4 близких ref из каталога. Не придумывай значения и не объединяй упражнения. Верни JSON строго по schema.",
      "Текст: " + body.text,
      "Каталог: " + JSON.stringify(catalog),
    ].join("\n")
    const modelUri = "gpt://" + Deno.env.get("YANDEX_CLOUD_FOLDER_ID") + "/yandexgpt-pro/latest"
    const response = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Api-Key " + Deno.env.get("YANDEX_CLOUD_API_KEY") }, body: JSON.stringify({ modelUri, completionOptions: { stream: false, temperature: 0, maxTokens: "2000" }, jsonSchema: { schema: OUTPUT_SCHEMA }, messages: [{ role: "user", text: prompt }] }) })
    if (!response.ok) { console.error(JSON.stringify({ event: "workout_parse_llm_error", status: response.status })); return json({ error: { code: "llm_unavailable", message: "Модель разбора временно недоступна" } }, 502) }
    const payload = await response.json() as { result?: { alternatives?: Array<{ message?: { text?: string } }> } }
    const result = validate(JSON.parse(payload.result?.alternatives?.[0]?.message?.text ?? ""), catalog)
    console.log(JSON.stringify({ event: "workout_parse_completed", items: result.items.length, unmatched: result.unmatched.length }))
    return json(result)
  } catch (error) {
    console.error(JSON.stringify({ event: "workout_parse_failed", message: error instanceof Error ? error.message : "unknown" }))
    return json({ error: { code: "parse_failed", message: "Не удалось разобрать диктовку" } }, 502)
  }
})
