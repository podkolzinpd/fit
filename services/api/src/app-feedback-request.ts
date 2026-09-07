export type AppFeedbackKind = 'suggestion' | 'problem'
export type AppDisplayMode = 'browser' | 'standalone'

export interface AppFeedbackDraft {
  kind: AppFeedbackKind
  message: string
  screenPath: string
  appVersion: string
  displayMode: AppDisplayMode
  userAgent: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function normalizedContext(value: unknown, fallback: string, max: number) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim() || fallback
  return normalized.slice(0, max)
}

export function readAppFeedbackRequest(body: unknown): AppFeedbackDraft | undefined {
  const input = record(body)
  if (input === undefined
    || typeof input.kind !== 'string'
    || typeof input.message !== 'string'
    || typeof input.displayMode !== 'string') {
    return undefined
  }

  const kind = input.kind.trim().toLowerCase()
  const message = input.message.trim()
  const displayMode = input.displayMode.trim().toLowerCase()
  const screenPath = normalizedContext(input.screenPath, '/', 500)
  const appVersion = normalizedContext(input.appVersion, 'unknown', 64)
  const userAgent = normalizedContext(input.userAgent, 'unknown', 512)

  if ((kind !== 'suggestion' && kind !== 'problem')
    || message.length < 3
    || message.length > 2000
    || (displayMode !== 'browser' && displayMode !== 'standalone')
    || screenPath === undefined
    || appVersion === undefined
    || userAgent === undefined) {
    return undefined
  }

  return {
    kind,
    message,
    screenPath,
    appVersion,
    displayMode,
    userAgent,
  }
}
