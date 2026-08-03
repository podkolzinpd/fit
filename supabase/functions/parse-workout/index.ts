import "jsr:@supabase/functions-js@^2/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2.110.8"

const URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { ...CORS, "Content-Type": "application/json" } })

type Exercise = { source: string; ref: string; customExerciseId?: string; name: string; inputKind: string }
type Item = { sourceText: string; exerciseRef: string; confidence: number; sets: Array<{ weightKg?: number; reps?: number; durationMin?: number; distanceKm?: number }> }
type Unmatched = { sourceText: string; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function validate(value: unknown, catalog: Exercise[]): { items: Item[]; unmatched: Unmatched[] } {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("invalid_output")
  const allowed = new Set(catalog.map((item) => item.ref))
  const items = value.items.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.exerciseRef !== "string" || !allowed.has(raw.exerciseRef) || !Array.isArray(raw.sets)) return []
    const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0
    const sets = raw.sets.filter(isRecord).map((set) => Object.fromEntries(["weightKg", "reps", "durationMin", "distanceKm"].flatMap((key) => typeof set[key] === "number" ? [[key, set[key]]] : [])))
    return [{ sourceText: typeof raw.sourceText === "string" ? raw.sourceText.trim() : "", exerciseRef: raw.exerciseRef, confidence, sets }]
  })
  const unmatched = Array.isArray(value.unmatched) ? value.unmatched.flatMap((raw) => isRecord(raw) && typeof raw.sourceText === "string" ? [{ sourceText: raw.sourceText.trim(), reason: typeof raw.reason === "string" ? raw.reason.trim() : "Не найдено в каталоге" }] : []) : []
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
    const body = await request.json() as { text?: unknown; catalog?: unknown }
    if (typeof body.text !== "string" || !Array.isArray(body.catalog) || body.text.length > 12000) return json({ error: "invalid_request" }, 400)
    const catalog = body.catalog.filter(isRecord).filter((item): item is Exercise => typeof item.ref === "string" && typeof item.name === "string" && typeof item.inputKind === "string")
    const prompt = ["Разбери всё описание тренировки целиком. Верни упражнения в исходном порядке. Не додумывай отсутствующие значения. Выбирай exerciseRef только из каталога. Верни только JSON по схеме items/unmatched.", "Текст: " + body.text, "Каталог: " + JSON.stringify(catalog.map(({ ref, name, inputKind }) => ({ ref, name, inputKind })))] .join("\n")
    const modelUri = "gpt://" + Deno.env.get("YANDEX_CLOUD_FOLDER_ID") + "/yandexgpt/latest"
    const response = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Api-Key " + Deno.env.get("YANDEX_CLOUD_API_KEY") }, body: JSON.stringify({ modelUri, completionOptions: { stream: false, temperature: 0, maxTokens: "2000" }, messages: [{ role: "user", text: prompt }] }) })
    if (!response.ok) return json({ error: "llm_unavailable" }, 502)
    const payload = await response.json() as { result?: { alternatives?: Array<{ message?: { text?: string } }> } }
    const raw = payload.result?.alternatives?.[0]?.message?.text ?? ""
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/\s*```$/, ""))
    return json(validate(parsed, catalog))
  } catch { return json({ error: "parse_failed" }, 502) }
})
