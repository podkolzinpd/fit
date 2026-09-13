import type {
  TrainerDiscoveryPromptAction,
  TrainerDiscoveryPromptPreference,
} from '../../shared/domain'
import { supabase } from '../queries/client'
import { repositoryError } from './error'

export interface TrainerDiscoveryRepository {
  getPromptPreference(): Promise<TrainerDiscoveryPromptPreference>
  setPromptPreference(action: TrainerDiscoveryPromptAction): Promise<TrainerDiscoveryPromptPreference>
}

export function parseTrainerDiscoveryPrompt(value: unknown): TrainerDiscoveryPromptPreference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Некорректное состояние поиска тренера')
  }
  const prompt = value as Record<string, unknown>
  if ((prompt.state !== 'visible' && prompt.state !== 'snoozed' && prompt.state !== 'dismissed')
    || (prompt.remindAt !== null && typeof prompt.remindAt !== 'string')
    || (prompt.updatedAt !== null && typeof prompt.updatedAt !== 'string')) {
    throw new Error('Некорректное состояние поиска тренера')
  }
  return {
    state: prompt.state,
    remindAt: prompt.remindAt,
    updatedAt: prompt.updatedAt,
  }
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
