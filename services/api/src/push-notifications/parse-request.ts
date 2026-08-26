import type { PushNotificationInput } from './send.js'

export class PushRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function parseNotification(value: unknown): PushNotificationInput {
  if (typeof value !== 'object' || value === null) {
    throw new PushRequestError(400, 'invalid_notification')
  }
  const record = value as Record<string, unknown>
  const subscription = record.subscription as Record<string, unknown> | undefined
  const keys = subscription?.keys as Record<string, unknown> | undefined

  if (!isNonEmptyString(record.id)) throw new PushRequestError(400, 'invalid_notification_id')
  if (!isNonEmptyString(subscription?.endpoint)) throw new PushRequestError(400, 'invalid_subscription_endpoint')
  if (!isNonEmptyString(keys?.p256dh) || !isNonEmptyString(keys?.auth)) {
    throw new PushRequestError(400, 'invalid_subscription_keys')
  }
  if (!isNonEmptyString(record.title) || !isNonEmptyString(record.body)) {
    throw new PushRequestError(400, 'invalid_notification_content')
  }

  return {
    id: record.id,
    subscription: { endpoint: subscription.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
    title: record.title,
    body: record.body,
    data: (typeof record.data === 'object' && record.data !== null ? record.data as Record<string, unknown> : {}),
  }
}

export function parsePushRequest(value: unknown): PushNotificationInput[] {
  if (typeof value !== 'object' || value === null) {
    throw new PushRequestError(400, 'request_body_required')
  }
  const notifications = (value as Record<string, unknown>).notifications
  if (!Array.isArray(notifications) || notifications.length === 0) {
    throw new PushRequestError(400, 'notifications_required')
  }
  if (notifications.length > 50) {
    throw new PushRequestError(400, 'too_many_notifications')
  }
  return notifications.map(parseNotification)
}
