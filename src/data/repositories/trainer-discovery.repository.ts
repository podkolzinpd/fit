import { parseTrainerDiscoveryPrompt } from './trainer-discovery-prompt'
import type {
  TrainerDiscoveryPromptAction,
  TrainerDiscoveryPromptPreference,
} from '../../shared/domain'
import { supabase } from '../queries/client'
import { repositoryError } from './error'

export { parseTrainerDiscoveryPrompt } from './trainer-discovery-prompt'

export interface TrainerDiscoveryRepository {
  getPromptPreference(): Promise<TrainerDiscoveryPromptPreference>
  setPromptPreference(action: TrainerDiscoveryPromptAction): Promise<TrainerDiscoveryPromptPreference>
}

export const trainerDiscoveryRepository: TrainerDiscoveryRepository = {
  async getPromptPreference() {
    const result = await supabase.rpc('get_trainer_discovery_prompt')
    if (result.error) throw repositoryError(result.error)
    return parseTrainerDiscoveryPrompt(result.data)
  },
  async setPromptPreference(action) {
    const result = await supabase.rpc('set_trainer_discovery_prompt', { p_action: action })
    if (result.error) throw repositoryError(result.error)
    return parseTrainerDiscoveryPrompt(result.data)
  },
}
