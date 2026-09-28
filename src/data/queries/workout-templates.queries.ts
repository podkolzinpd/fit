import type { WorkoutTemplateDraft } from '../../shared/domain'
import { supabase } from './client'
import { toJson } from './json'

const columns = 'id,trainer_id,name,notes,exercises,version,created_at,updated_at'

export const workoutTemplateQueries = {
  list: () => supabase.from('workout_templates').select(columns).is('archived_at', null).order('updated_at', { ascending: false }),
  get: (id: string) => supabase.from('workout_templates').select(columns).eq('id', id).is('archived_at', null).single(),
  save: (draft: WorkoutTemplateDraft) => supabase.rpc('save_workout_template', {
    p_template: toJson(draft), p_expected_version: draft.version ?? null,
  }),
  archive: (id: string, version: number) => supabase.rpc('archive_workout_template', {
    p_template_id: id, p_expected_version: version,
  }),
}
