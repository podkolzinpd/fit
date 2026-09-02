import type {
  PushNotificationInput,
  PushNotificationResult,
} from './send.js'

type Fetch = typeof fetch

export interface PushNotificationSender {
  send(
    notifications: readonly PushNotificationInput[],
  ): Promise<PushNotificationResult[]>
}

function readSenderUrl(value: string): string {
  const parsed = new URL(value)
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'functions.yandexcloud.net'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.search !== ''
    || parsed.hash !== ''
  ) {
    throw new Error('PUSH_FUNCTION_URL must be a Yandex Cloud Functions HTTPS URL')
  }
  return parsed.href
}

function readResult(value: unknown, expectedIds: ReadonlySet<string>): PushNotificationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Push sender returned an unsupported result')
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !expectedIds.has(record.id)) {
    throw new Error('Push sender returned an unexpected notification id')
  }
  if (record.ok === true) return { id: record.id, ok: true }
  if (
    record.ok !== false
    || typeof record.status !== 'number'
    || !Number.isInteger(record.status)
    || record.status < 0
    || record.status > 599
  ) {
    throw new Error('Push sender returned an unsupported failure')
  }
  return {
    id: record.id,
    ok: false,
    status: record.status,
    error: record.status === 0
      ? 'push_delivery_failed'
      : `web_push_${record.status}`,
  }
}

export class YandexPushNotificationSender implements PushNotificationSender {
  private readonly functionUrl: string

  constructor(
    functionUrl: string,
    private readonly dispatchSecret: string,
    private readonly fetch_: Fetch = fetch,
  ) {
    this.functionUrl = readSenderUrl(functionUrl)
    if (dispatchSecret.length < 32) {
      throw new Error('PUSH_DISPATCH_SECRET must contain at least 32 characters')
    }
  }

  async send(
    notifications: readonly PushNotificationInput[],
  ): Promise<PushNotificationResult[]> {
    if (notifications.length === 0 || notifications.length > 50) {
      throw new Error('Push dispatcher batch must contain between 1 and 50 notifications')
    }
    const expectedIds = new Set(notifications.map((notification) => notification.id))
    if (expectedIds.size !== notifications.length) {
      throw new Error('Push dispatcher batch contains duplicate ids')
    }

    const response = await this.fetch_(this.functionUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'content-type': 'application/json',
        'x-push-dispatch-secret': this.dispatchSecret,
      },
      body: JSON.stringify({ notifications }),
    })
    if (!response.ok) {
      throw new Error(`Push sender returned HTTP ${response.status}`)
    }

    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new Error('Push sender returned an unsupported response')
    }
    const results = (body as Record<string, unknown>).results
    if (!Array.isArray(results) || results.length !== notifications.length) {
      throw new Error('Push sender returned an incomplete result set')
    }
    const parsed = results.map((result) => readResult(result, expectedIds))
    if (new Set(parsed.map((result) => result.id)).size !== expectedIds.size) {
      throw new Error('Push sender returned duplicate results')
    }
    return parsed
  }
}
