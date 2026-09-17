import { isAssistantProgramEnabled } from '../../app/feature-flags'

const supportedAssistantBackends = new Set(['supabase', 'yandex'])

export function isAssistantProgramSurfaceEnabled(cacheKey: string, userId?: string): boolean {
  return userId !== undefined
    && supportedAssistantBackends.has(cacheKey)
    && isAssistantProgramEnabled(userId)
}
