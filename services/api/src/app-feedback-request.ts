export type AppFeedbackKind = 'suggestion' | 'problem' | 'training program'
export type AppDisplayMode = 'browser' | 'standalone'

export interface AppFeedbackDraft {
  kind: AppFeedbackKind
  message: string
  screenPath: string
  appVersion: string
  displayMode: AppDisplayMode
  userAgent: string
  modelInputJson?: Record<string, unknown>
  modelOutputJson?: Record<string, unknown>
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

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
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

  const modelInputJson = jsonObject(input.modelInputJson)
  const modelOutputJson = jsonObject(input.modelOutputJson)
  if ((kind !== 'suggestion' && kind !== 'problem' && kind !== 'training program')
    || message.length < 3
    || message.length > 2000
    || (displayMode !== 'browser' && displayMode !== 'standalone')
    || screenPath === undefined
    || appVersion === undefined
    || userAgent === undefined
    || (kind === 'training program' && (modelInputJson === undefined || modelOutputJson === undefined))
    || ((modelInputJson === undefined) !== (modelOutputJson === undefined))) {
    return undefined
  }

  return {
    kind,
    message,
    screenPath,
    appVersion,
    displayMode,
    userAgent,
    ...(modelInputJson === undefined || modelOutputJson === undefined ? {} : { modelInputJson, modelOutputJson }),
  }
}
