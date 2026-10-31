import type { TrainerDiscoveryPromptAction, TrainerDiscoveryPromptPreference } from '../../shared/domain'

export interface TrainerDiscoveryRepository {
  getPromptPreference(): Promise<TrainerDiscoveryPromptPreference>
  setPromptPreference(action: TrainerDiscoveryPromptAction): Promise<TrainerDiscoveryPromptPreference>
}
