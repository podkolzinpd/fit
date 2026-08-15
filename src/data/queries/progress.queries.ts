import type { ProgressDraft } from '../../shared/domain'
import { supabase } from './client'
import { toJson } from './json'

export const progressQueries = {
  regularity: (clientId: string) => supabase.rpc('get_workout_regularity', { p_client_id: clientId }),
  list: (clientId: string) => supabase.from('client_progress')
    .select('id,client_id,created_by,recorded_on,weight_kg,chest_cm,waist_cm,hip_cm,notes,version')
    .eq('client_id', clientId).is('deleted_at', null).order('recorded_on', { ascending: false }),
  listCustomValues: (clientId: string) => supabase.from('client_progress_custom')
    .select('progress_id,metric_id,value').eq('client_id', clientId),
  save: (draft: ProgressDraft) => supabase.rpc('save_progress', {
    p_progress: toJson(draft), p_expected_version: draft.version ?? null,
  }),
  remove: (id: string, version: number) => supabase.rpc('soft_delete_progress', {
    p_progress_id: id, p_expected_version: version,
  }),
  listMetrics: (clientId: string) => supabase.from('client_custom_metrics')
    .select('id,client_id,name,unit,archived_at,version').eq('client_id', clientId).order('name'),
  createMetric: (trainerId: string, clientId: string, name: string, unit: string | null) =>
    supabase.from('client_custom_metrics').insert({ trainer_id: trainerId, client_id: clientId, name, unit })
      .select('id,client_id,name,unit,archived_at,version').single(),
  updateMetric: (id: string, version: number, name: string, unit: string | null) =>
    supabase.from('client_custom_metrics').update({ name, unit, version: version + 1 })
      .eq('id', id).eq('version', version).select('id,client_id,name,unit,archived_at,version').single(),
  setMetricArchived: (id: string, version: number, archived: boolean) =>
    supabase.from('client_custom_metrics').update({ archived_at: archived ? new Date().toISOString() : null, version: version + 1 })
      .eq('id', id).eq('version', version).select('id,client_id,name,unit,archived_at,version').single(),
}
