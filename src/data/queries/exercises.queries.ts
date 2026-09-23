import { getSupabaseClient } from './client'
import type { ExerciseSnapshot } from '../../shared/domain'
import type { CustomMetric } from '../../shared/domain'
import { isActiveCatalogExercise } from '../../shared/exercise-catalog-retirement'
import { yandexAppSessionTransport } from '../yandex-app-session-transport'
import { fetchWithRequestDiagnostics } from './request-diagnostics'

export type WorkoutParseResponse = {
  items: Array<{ sourceText: string; exerciseRef: string; confidence: number; sets: Array<{ weightKg?: number; reps?: number; durationMin?: number; distanceKm?: number }>; position?: number }>
  unmatched: Array<{ sourceText: string; reason: string; suggestedExerciseRefs: string[]; sets?: Array<{ weightKg?: number; reps?: number; durationMin?: number; distanceKm?: number }>; position?: number }>
}

export type GoalCriteriaSuggestionResponse = {
  criteria: unknown[]
  needsInput: Array<{ message: string; exerciseRefs: string[] }>
  unsupportedReason: string | null
}

const parserUrl = 'https://functions.yandexcloud.net/d4eicdja8le8ivq53u9f'
const isLocalSupabase = typeof import.meta.env.VITE_SUPABASE_URL === 'string'
  && import.meta.env.VITE_SUPABASE_URL.includes('127.0.0.1:54321')

export const parseWorkout = (text: string, systemCatalog: readonly ExerciseSnapshot[]) => {
  const appSession = yandexAppSessionTransport()
  if (appSession) {
    return fetchWithRequestDiagnostics(globalThis.fetch, `${appSession.apiBaseUrl}/v1/assistant/yandex/parse-workout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fit-session': appSession.sessionToken },
      body: JSON.stringify({ text, systemCatalog }),
    }).then(async (response) => response.ok
      ? { data: await response.json() as WorkoutParseResponse, error: null }
      : { data: null, error: { context: response } })
      .catch((error) => ({ data: null, error: error instanceof Error ? error : new Error('parse_workout_request_failed') }))
  }
  if (isLocalSupabase) {
    return getSupabaseClient().functions.invoke<WorkoutParseResponse>('parse-workout', { body: { text, systemCatalog } })
  }
  return getSupabaseClient().auth.getSession().then(async ({ data: { session } }) => {
    if (!session?.access_token) return { data: null, error: new Error('authentication_required') }
    try {
      const response = await fetch(parserUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-supabase-authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ text, systemCatalog }),
      })
      if (!response.ok) return { data: null, error: { context: response } }
      return { data: await response.json() as WorkoutParseResponse, error: null }
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error('parse_workout_request_failed') }
    }
  })
}

export const suggestGoalCriteria = (text: string, catalog: readonly ExerciseSnapshot[], metrics: readonly CustomMetric[]) => {
  const body = { kind: 'goal_criteria', text, systemCatalog: catalog.filter((item) => item.source === 'system' && isActiveCatalogExercise(item)), customMetrics: metrics }
  const appSession = yandexAppSessionTransport()
  if (appSession) {
    return fetchWithRequestDiagnostics(globalThis.fetch, `${appSession.apiBaseUrl}/v1/assistant/yandex/parse-workout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fit-session': appSession.sessionToken },
      body: JSON.stringify(body),
    }).then(async (response) => response.ok
      ? { data: await response.json() as GoalCriteriaSuggestionResponse, error: null }
      : { data: null, error: { context: response } })
      .catch((error) => ({ data: null, error: error instanceof Error ? error : new Error('goal_suggestion_request_failed') }))
  }
  if (isLocalSupabase) return getSupabaseClient().functions.invoke<GoalCriteriaSuggestionResponse>('parse-workout', { body })
  return getSupabaseClient().auth.getSession().then(async ({ data: { session } }) => {
    if (!session?.access_token) return { data: null, error: new Error('authentication_required') }
    try {
      const response = await fetch(parserUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-supabase-authorization': `Bearer ${session.access_token}` }, body: JSON.stringify(body) })
      return response.ok
        ? { data: await response.json() as GoalCriteriaSuggestionResponse, error: null }
        : { data: null, error: { context: response } }
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error('goal_suggestion_request_failed') }
    }
  })
}

const columns = 'id,name,muscle_group,input_kind,created_by,archived_at,version,primary_muscle_detail,equipment,description,image_path,image_mime_type,image_width,image_height,image_size_bytes'

export type CustomExerciseWriteValue = {
  name: string
  muscle_group: string
  input_kind: string
  primary_muscle_detail?: string | null
  equipment?: string | null
  description?: string | null
  image_path?: string | null
  image_mime_type?: string | null
  image_width?: number | null
  image_height?: number | null
  image_size_bytes?: number | null
}

export function customExerciseMedia() {
  return getSupabaseClient().storage.from('custom-exercise-media')
}

export const exerciseQueries = {
  async createVitalMediaUrl(path: string, expiresIn: number) {
    return getSupabaseClient().storage.from('fit-exercise-media').createSignedUrl(path, expiresIn)
  },
  async createCustomExercisePhotoUrl(path: string, expiresIn: number) {
    return customExerciseMedia().createSignedUrl(path, expiresIn)
  },
  parseWorkout,
  suggestGoalCriteria,
  list: () => getSupabaseClient().from('custom_exercises').select(columns).order('name'),
  create: (trainerId: string, value: CustomExerciseWriteValue & { id?: string }) =>
    getSupabaseClient().from('custom_exercises').insert({ trainer_id: trainerId, ...value }).select(columns).single(),
  update: (id: string, version: number, value: CustomExerciseWriteValue) =>
    getSupabaseClient().from('custom_exercises').update({ ...value, version: version + 1 }).eq('id', id).eq('version', version).select(columns).single(),
  setArchived: (id: string, version: number, archived: boolean) => getSupabaseClient().from('custom_exercises')
    .update({ archived_at: archived ? new Date().toISOString() : null, version: version + 1 })
    .eq('id', id).eq('version', version).select(columns).single(),
}
