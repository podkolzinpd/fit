import type { ProgressDraft } from '../../shared/domain'
import { getSupabaseClient } from './client'
import { toJson } from './json'

export const progressQueries = {
  regularity: (clientId: string) => getSupabaseClient().rpc('get_workout_regularity', { p_client_id: clientId }),
  running: (clientId: string, periodStart: string, periodEnd: string) => getSupabaseClient().rpc('list_running_progress', {
    p_client_id: clientId, p_period_start: periodStart, p_period_end: periodEnd,
  }),
  list: (clientId: string) => getSupabaseClient().from('client_progress')
    .select('id,client_id,created_by,recorded_on,weight_kg,chest_cm,waist_cm,hip_cm,notes,version')
    .eq('client_id', clientId).is('deleted_at', null).order('recorded_on', { ascending: false }),
  listCustomValues: (clientId: string) => getSupabaseClient().from('client_progress_custom')
    .select('progress_id,metric_id,value').eq('client_id', clientId),
  save: (draft: ProgressDraft) => getSupabaseClient().rpc('save_progress', {
    p_progress: toJson(draft), p_expected_version: draft.version ?? null,
  }),
  remove: (id: string, version: number) => getSupabaseClient().rpc('soft_delete_progress', {
    p_progress_id: id, p_expected_version: version,
  }),
  listMetrics: (clientId: string) => getSupabaseClient().from('client_custom_metrics')
    .select('id,client_id,name,unit,archived_at,version').eq('client_id', clientId).order('name'),
  createMetric: (clientId: string, name: string, unit: string | null) =>
    getSupabaseClient().rpc('create_client_custom_metric', { p_client_id: clientId, p_name: name, ...(unit ? { p_unit: unit } : {}) }),
  updateMetric: (id: string, version: number, name: string, unit: string | null) =>
    getSupabaseClient().from('client_custom_metrics').update({ name, unit, version: version + 1 })
      .eq('id', id).eq('version', version).select('id,client_id,name,unit,archived_at,version').single(),
  setMetricArchived: (id: string, version: number, archived: boolean) =>
    getSupabaseClient().rpc('set_client_custom_metric_archived', { p_metric_id: id, p_expected_version: version, p_archived: archived }),
}
