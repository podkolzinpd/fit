import type { SaveClientGoalInput, SaveGoalStageInput } from '../../shared/domain'
import { getSupabaseClient } from './client'
import { toJson } from './json'

export const goalsQueries = {
  get: (clientId: string) => getSupabaseClient().rpc('get_client_goal', { p_client_id: clientId }),
  save: (input: SaveClientGoalInput) => getSupabaseClient().rpc('save_client_goal', {
    p_goal: toJson(input), p_expected_version: input.version ?? undefined,
  }),
  archive: (goalId: string, version: number) => getSupabaseClient().rpc('archive_client_goal', {
    p_goal_id: goalId, p_expected_version: version,
  }),
  saveStage: (input: SaveGoalStageInput) => getSupabaseClient().rpc('save_goal_stage', {
    p_stage: toJson(input), p_expected_version: input.version ?? undefined,
  }),
  deleteStage: (stageId: string) => getSupabaseClient().rpc('delete_goal_stage', { p_stage_id: stageId }),
}
