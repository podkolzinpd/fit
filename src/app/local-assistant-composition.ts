import { supabaseAssistantBackend } from '../data/repositories/assistant.repository'

export const localLegacyAvailable = true

export function getLocalAssistantBackend() {
  return supabaseAssistantBackend
}
