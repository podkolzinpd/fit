export const PUSH_NOTIFICATION_KINDS = [
  'workout_reminder',
  'workout_scheduled',
] as const

export type PushNotificationKind = typeof PUSH_NOTIFICATION_KINDS[number]

export interface PushSubscriptionDraft {
  endpoint: string
  p256dh: string
  authKey: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function validHttpsEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
  } catch {
    return false
  }
}

export function readPushNotificationKind(value: unknown): PushNotificationKind | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return PUSH_NOTIFICATION_KINDS.find((kind) => kind === normalized)
}

export function readPushSubscriptionRequest(body: unknown): PushSubscriptionDraft | undefined {
  const input = record(body)
  if (input === undefined
    || typeof input.endpoint !== 'string'
    || typeof input.p256dh !== 'string'
    || typeof input.authKey !== 'string') {
    return undefined
  }

  const endpoint = input.endpoint.trim()
  const p256dh = input.p256dh.trim()
  const authKey = input.authKey.trim()
  if (endpoint.length === 0
    || endpoint.length > 2048
    || !validHttpsEndpoint(endpoint)
    || p256dh.length === 0
    || p256dh.length > 512
    || authKey.length === 0
    || authKey.length > 512) {
    return undefined
  }

  return { endpoint, p256dh, authKey }
}

export function readNotificationPreferenceRequest(
  body: unknown,
): { enabled: boolean } | undefined {
  const input = record(body)
  if (input === undefined || typeof input.enabled !== 'boolean') return undefined
  return { enabled: input.enabled }
}
