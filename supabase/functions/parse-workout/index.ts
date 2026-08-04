import "jsr:@supabase/functions-js@^2/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2.110.8"

const URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { ...CORS, "Content-Type": "application/json" } })

type Exercise = { source: string; ref: string; customExerciseId?: string; name: string; inputKind: string }
type Item = { sourceText: string; exerciseRef: string; confidence: number; sets: Array<{ weightKg?: number; reps?: number; durationMin?: number; distanceKm?: number }> }
type Unmatched = { sourceText: string; reason: string }
type Segment = { sourceText: string; candidates: Array<{ ref: string; name: string; inputKind: string }> }

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
          sourceText: { type: "string" }, exerciseRef: { type: "string" }, confidence: { type: "number" },
          sets: { type: "array", items: { type: "object", additionalProperties: false, properties: { weightKg: { type: "number" }, reps: { type: "number" }, durationMin: { type: "number" }, distanceKm: { type: "number" } } },
        },
      },
    },
    unmatched: { type: "array", items: { type: "object", additionalProperties: false, required: ["sourceText", "reason"], properties: { sourceText: { type: "string" }, reason: { type: "string" } } } },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function validate(value: unknown, segments: Segment[]): { items: Item[]; unmatched: Unmatched[] } {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("invalid_output")
  const candidatesBySource = new Map(segments.map((segment) => [segment.sourceText, new Set(segment.candidates.map((candidate) => candidate.ref))]))
  const items = value.items.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.sourceText !== "string" || typeof raw.exerciseRef !== "string" || !candidatesBySource.get(raw.sourceText.trim())?.has(raw.exerciseRef) || !Array.isArray(raw.sets)) return []
    const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0
    const sets = raw.sets.filter(isRecord).map((set) => Object.fromEntries(["weightKg", "reps", "durationMin", "distanceKm"].flatMap((key) => typeof set[key] === "number" ? [[key, set[key]]] : [])))
    return [{ sourceText: typeof raw.sourceText === "string" ? raw.sourceText.trim() : "", exerciseRef: raw.exerciseRef, confidence, sets }]
  })
  const unmatched = Array.isArray(value.unmatched) ? value.unmatched.flatMap((raw) => isRecord(raw) && typeof raw.sourceText === "string" && candidatesBySource.has(raw.sourceText.trim()) ? [{ sourceText: raw.sourceText.trim(), reason: typeof raw.reason === "string" ? raw.reason.trim() : "Не найдено в каталоге" }] : []) : []
  const handled = new Set([...items.map((item) => item.sourceText), ...unmatched.map((item) => item.sourceText)])
  return { items, unmatched: [...unmatched, ...segments.filter((segment) => !handled.has(segment.sourceText)).map((segment) => ({ sourceText: segment.sourceText, reason: "Модель не вернула результат для фрагмента" }))] }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS })
  try {
    const auth = request.headers.get("Authorization")
    if (!auth) return json({ error: "unauthorized" }, 401)
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: "unauthorized" }, 401)
    const body = await request.json() as { text?: unknown; catalog?: unknown; segments?: unknown }
    if (typeof body.text !== "string" || !Array.isArray(body.catalog) || !Array.isArray(body.segments) || body.text.length > 12000) return json({ error: { code: "invalid_request", message: "Некорректный запрос разбора тренировки" } }, 400)
    const catalog = body.catalog.filter(isRecord).filter((item): item is Exercise => typeof item.ref === "string" && typeof item.name === "string" && typeof item.inputKind === "string")
    const knownRefs = new Set(catalog.map((item) => item.ref))
    const segments = body.segments
      .slice(0, 30)
      .flatMap((raw): Segment[] => isRecord(raw) && typeof raw.sourceText === "string" && raw.sourceText.trim().length <= 600 && Array.isArray(raw.candidates)
        ? [{ sourceText: raw.sourceText.trim(), candidates: raw.candidates.slice(0, 8).flatMap((candidate) => isRecord(candidate) && typeof candidate.ref === "string" && knownRefs.has(candidate.ref) && typeof candidate.name === "string" && typeof candidate.inputKind === "string" ? [{ ref: candidate.ref, name: candidate.name, inputKind: candidate.inputKind }] : []) }]
        : [])
      .filter((segment) => segment.sourceText)
    if (!segments.length) return json({ error: { code: "no_segments", message: "Не удалось выделить упражнения из текста" } }, 400)
    const prompt = [
      "Ты разбираешь запись тренировки. Для КАЖДОГО фрагмента верни ровно один объект: либо items с exerciseRef из candidates этого же фрагмента, либо unmatched. Не объединяй фрагменты, не придумывай упражнение, не используй ref вне candidates. Значения переноси только если они явно произнесены. Верни JSON строго по schema.",
      "Фрагменты и кандидаты: " + JSON.stringify(segments),
    ].join("\n")
    const modelUri = "gpt://" + Deno.env.get("YANDEX_CLOUD_FOLDER_ID") + "/yandexgpt-pro/latest"
    const response = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Api-Key " + Deno.env.get("YANDEX_CLOUD_API_KEY") }, body: JSON.stringify({ modelUri, completionOptions: { stream: false, temperature: 0, maxTokens: "1600" }, jsonSchema: { schema: OUTPUT_SCHEMA }, messages: [{ role: "user", text: prompt }] }) })
    if (!response.ok) {
      console.error(JSON.stringify({ event: "workout_parse_llm_error", status: response.status }))
      return json({ error: { code: "llm_unavailable", message: "Модель разбора временно недоступна" } }, 502)
    }
    const payload = await response.json() as { result?: { alternatives?: Array<{ message?: { text?: string } }> } }
    const raw = payload.result?.alternatives?.[0]?.message?.text ?? ""
    const parsed = JSON.parse(raw)
    const result = validate(parsed, segments)
    console.log(JSON.stringify({ event: "workout_parse_completed", segments: segments.length, items: result.items.length, unmatched: result.unmatched.length }))
    return json(result)
  } catch (error) {
    console.error(JSON.stringify({ event: "workout_parse_failed", message: error instanceof Error ? error.message : "unknown" }))
    return json({ error: { code: "parse_failed", message: "Не удалось разобрать диктовку" } }, 502)
  }
})
