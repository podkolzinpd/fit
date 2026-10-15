import type { getLocalAuthRepository as localAuth } from './local-auth-composition'
import type { getLocalDataBackend as localData } from './local-data-composition'
import type { getLocalAssistantBackend as localAssistant } from './local-assistant-composition'

export const localLegacyAvailable = false

export function getLocalAuthRepository(): ReturnType<typeof localAuth> {
  throw new Error('Устаревший источник данных недоступен в этой сборке.')
}

export function getLocalDataBackend(): ReturnType<typeof localData> {
  throw new Error('Устаревший источник данных недоступен в этой сборке.')
}

export function getLocalAssistantBackend(): ReturnType<typeof localAssistant> {
  throw new Error('Устаревший источник данных недоступен в этой сборке.')
}
