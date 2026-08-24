import { supabase } from './client'
import type { ExerciseSnapshot } from '../../shared/domain'
import { invokeLegacyCloudFunction } from './legacy-cloud-functions'

export type WorkoutParseResponse = {
  items: Array<{ sourceText: string; exerciseRef: string; confidence: number; sets: Array<{ weightKg?: number; reps?: number; durationMin?: number; distanceKm?: number }> }>
  unmatched: Array<{ sourceText: string; reason: string; suggestedExerciseRefs: string[] }>
}

const parserUrl = 'https://functions.yandexcloud.net/d4eicdja8le8ivq53u9f'
const isLocalSupabase = typeof import.meta.env.VITE_SUPABASE_URL === 'string'
  && import.meta.env.VITE_SUPABASE_URL.includes('127.0.0.1:54321')

export const parseWorkout = (text: string, systemCatalog: readonly ExerciseSnapshot[]) => {
  if (isLocalSupabase) {
    return supabase.functions.invoke<WorkoutParseResponse>('parse-workout', { body: { text, systemCatalog } })
  }
  return supabase.auth.getSession().then(async ({ data: { session } }) => {
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

const columns = 'id,name,muscle_group,input_kind,archived_at,version'

export const exerciseQueries = {
  parseWorkout,
  list: () => supabase.from('custom_exercises').select(columns).order('name'),
  create: (trainerId: string, value: { name: string; muscle_group: string; input_kind: string }) =>
    supabase.from('custom_exercises').insert({ trainer_id: trainerId, ...value }).select(columns).single(),
  update: (id: string, version: number, value: { name: string; muscle_group: string; input_kind: string }) =>
    supabase.from('custom_exercises').update({ ...value, version: version + 1 }).eq('id', id).eq('version', version).select(columns).single(),
  setArchived: (id: string, version: number, archived: boolean) => supabase.from('custom_exercises')
    .update({ archived_at: archived ? new Date().toISOString() : null, version: version + 1 })
    .eq('id', id).eq('version', version).select(columns).single(),
}
