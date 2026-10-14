import type { getLocalLegacyComposition as localComposition } from './local-legacy-composition'

export const localLegacyAvailable = false

export function getLocalLegacyComposition(): ReturnType<typeof localComposition> {
  throw new Error('Устаревший источник данных недоступен в этой сборке.')
}
