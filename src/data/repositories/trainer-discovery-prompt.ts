import type { TrainerDiscoveryPromptPreference } from '../../shared/domain'

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

