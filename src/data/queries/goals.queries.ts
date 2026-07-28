import type { SaveClientGoalInput, SaveGoalStageInput } from '../../shared/domain'
import { supabase } from './client'
import { toJson } from './json'

export const goalsQueries = {
  get: (clientId: string) => supabase.rpc('get_client_goal', { p_client_id: clientId }),
  save: (input: SaveClientGoalInput) => supabase.rpc('save_client_goal', {
    p_goal: toJson(input), p_expected_version: input.version ?? undefined,
  }),
  archive: (goalId: string, version: number) => supabase.rpc('archive_client_goal', {
    p_goal_id: goalId, p_expected_version: version,
  }),
  saveStage: (input: SaveGoalStageInput) => supabase.rpc('save_goal_stage', {
    p_stage: toJson(input), p_expected_version: input.version ?? undefined,
  }),
  deleteStage: (stageId: string) => supabase.rpc('delete_goal_stage', { p_stage_id: stageId }),
}
