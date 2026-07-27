import type { CreateClientInput, UpdateClientInput } from '../../shared/domain'
import { supabase } from './client'
import { toJson } from './json'

const clientColumns = 'id,full_name,gender,age_years,age_updated_at,height_cm,goal,archived_at,version'

export const clientQueries = {
  getMine: () => supabase.rpc('get_my_client'),
  list: (includeArchived = false) => supabase.rpc('list_clients', { p_include_archived: includeArchived }),
  get: (id: string) => supabase.from('clients').select(clientColumns).eq('id', id).single(),
  getNote: (id: string) => supabase.from('client_private_details').select('note').eq('client_id', id).maybeSingle(),
  getLatestWeight: (id: string) => supabase.from('client_progress').select('weight_kg')
    .eq('client_id', id).is('deleted_at', null).not('weight_kg', 'is', null)
    .order('recorded_on', { ascending: false }).limit(1).maybeSingle(),
  create: (input: CreateClientInput) => supabase.rpc('create_client', { p_client: toJson(input) }),
  update: (input: UpdateClientInput) => supabase.rpc('update_client', {
    p_client: toJson(input), p_expected_version: input.version,
  }),
  setArchived: (id: string, version: number, archived: boolean) => supabase.from('clients')
    .update({ archived_at: archived ? new Date().toISOString() : null, version: version + 1 })
    .eq('id', id).eq('version', version).select(clientColumns).single(),
}
