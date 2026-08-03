import { supabase } from './client'
import type { ExerciseSnapshot } from '../../shared/domain'

export type WorkoutParseResponse = {
  items: Array<{ sourceText: string; exerciseRef: string; confidence: number; sets: Array<{ weightKg?: number; reps?: number; durationMin?: number; distanceKm?: number }> }>
  unmatched: Array<{ sourceText: string; reason: string }>
}

export const parseWorkout = (text: string, catalog: readonly ExerciseSnapshot[]) =>
  supabase.functions.invoke<WorkoutParseResponse>('parse-workout', { body: { text, catalog } })

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
