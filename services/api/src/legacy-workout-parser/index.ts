import { createClient } from '@supabase/supabase-js'
import { aiStudioUsage, reportAiStudioMetric } from '../ai-studio-usage-metrics.js'
import {
  matchWorkoutExtraction,
  readSystemExercise,
  validateWorkoutExtraction,
  workoutExtractionPrompt,
  workoutExtractionSchema,
  type WorkoutParserExercise,
} from './extracted-workout.js'

const completionUrl = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion'

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new HttpError(500, `missing_${name.toLowerCase()}`)
  return value
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
    const system = body.systemCatalog.flatMap((raw): WorkoutParserExercise[] => {
      const exercise = readSystemExercise(raw)
      return exercise ? [exercise] : []
    })
    const { data: customs, error } = await supabase.from('custom_exercises').select('id,name,input_kind,archived_at').is('archived_at', null)
    if (error) throw new HttpError(500, 'custom_exercises_lookup_failed')
    const custom = (customs ?? []).flatMap((raw): WorkoutParserExercise[] => typeof raw.id === 'string' && typeof raw.name === 'string' && typeof raw.input_kind === 'string' ? [{ source: 'custom', ref: raw.id, name: raw.name, inputKind: raw.input_kind }] : [])
    const catalog = [...system, ...custom]
    if (!catalog.length) throw new HttpError(400, 'empty_catalog')
    const prompt = workoutExtractionPrompt(body.text)
    const startedAt = Date.now()
    const apiKey = required('YANDEX_CLOUD_API_KEY')
    const modelUri = `gpt://${required('YANDEX_CLOUD_FOLDER_ID')}/${process.env.YANDEX_CLOUD_MODEL_ID ?? 'yandexgpt'}/latest`
    const invocationId = request.headers.get('x-yc-request-id')
    const iamToken = request.headers.get('x-yc-iam-token')
    let response: Response
    try {
      response = await fetch(completionUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Api-Key ${apiKey}` }, body: JSON.stringify({ modelUri, completionOptions: { stream: false, temperature: 0, maxTokens: '1200' }, jsonSchema: { schema: workoutExtractionSchema }, messages: [{ role: 'user', text: prompt }] }) })
    } catch (error) {
      console.error(JSON.stringify({ event: 'workout_parse_llm_network_error', modelCallCount: 1, message: error instanceof Error ? error.message : 'unknown' }))
      throw new HttpError(502, 'llm_unavailable')
    }
    if (!response.ok) {
      await reportAiStudioMetric({
        functionName: 'fit-parse-workout', modelUri, invocationId, iamToken,
        upstreamRequestId: response.headers.get('x-request-id'), usage: null,
      })
      console.error(JSON.stringify({ event: 'workout_parse_llm_error', modelCallCount: 1, status: response.status, catalogCount: catalog.length, promptBytes: Buffer.byteLength(prompt) }))
      throw new HttpError(502, 'llm_unavailable')
    }
    let payload: { result?: { alternatives?: Array<{ message?: { text?: string } }>; usage?: unknown } }
    try {
      payload = await response.json() as { result?: { alternatives?: Array<{ message?: { text?: string } }>; usage?: unknown } }
    } catch (error) {
      await reportAiStudioMetric({
        functionName: 'fit-parse-workout', modelUri, invocationId, iamToken,
        upstreamRequestId: response.headers.get('x-request-id'), usage: null,
      })
      console.error(JSON.stringify({ event: 'workout_parse_invalid_response', modelCallCount: 1, message: error instanceof Error ? error.message : 'unknown' }))
      throw new HttpError(502, 'parse_failed')
    }
    const usage = aiStudioUsage(payload.result?.usage)
    await reportAiStudioMetric({
      functionName: 'fit-parse-workout', modelUri, invocationId, iamToken,
      upstreamRequestId: response.headers.get('x-request-id'), usage,
    })
    try {
      const extracted = validateWorkoutExtraction(JSON.parse(payload.result?.alternatives?.[0]?.message?.text ?? ''))
      const result = matchWorkoutExtraction(extracted, catalog)
      console.log(JSON.stringify({
        event: 'workout_parse_completed', modelCallCount: 1, durationMs: Date.now() - startedAt,
        inputLineCount: body.text.split('\n').filter(Boolean).length,
        catalogCount: catalog.length, promptBytes: Buffer.byteLength(prompt), usage, extractedCount: extracted.items.length,
        matchedCount: result.items.length, unmatchedCount: result.unmatched.length,
        ambiguousCount: result.unmatched.filter((item) => item.suggestedExerciseRefs.length > 1).length,
      }))
      return Response.json(result)
    } catch (error) {
      console.error(JSON.stringify({ event: 'workout_parse_invalid_response', modelCallCount: 1, message: error instanceof Error ? error.message : 'unknown' }))
      throw new HttpError(502, 'parse_failed')
    }
  } catch (error) {
    const known = error instanceof HttpError ? error : new HttpError(502, 'parse_failed')
    console.error(JSON.stringify({ event: 'workout_parse_failed', code: known.code, status: known.status }))
    return Response.json({ error: { code: known.code, message: 'Не удалось разобрать диктовку' } }, { status: known.status })
  }
}
