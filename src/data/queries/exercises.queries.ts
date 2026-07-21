import { supabase } from './client'

const columns = 'id,name,muscle_group,input_kind,archived_at,version'

export const exerciseQueries = {
  list: () => supabase.from('custom_exercises').select(columns).order('name'),
  create: (trainerId: string, value: { name: string; muscle_group: string; input_kind: string }) =>
    supabase.from('custom_exercises').insert({ trainer_id: trainerId, ...value }).select(columns).single(),
  update: (id: string, version: number, value: { name: string; muscle_group: string; input_kind: string }) =>
    supabase.from('custom_exercises').update({ ...value, version: version + 1 }).eq('id', id).eq('version', version).select(columns).single(),
  setArchived: (id: string, version: number, archived: boolean) => supabase.from('custom_exercises')
    .update({ archived_at: archived ? new Date().toISOString() : null, version: version + 1 })
    .eq('id', id).eq('version', version).select(columns).single(),
}
