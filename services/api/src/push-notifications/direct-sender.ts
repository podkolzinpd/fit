import webpush from 'web-push'
import type { PushNotificationSender } from './http-sender.js'
import type { PushNotificationInput, PushNotificationResult, VapidConfig } from './send.js'

// Reuse the original VAPID identity but send directly from Cloud.ru, without
// waiting for a second cloud function's aggregate HTTP response.
export class DirectPushNotificationSender implements PushNotificationSender {
  private readonly vapid: VapidConfig

  constructor(vapid: VapidConfig) { this.vapid = vapid }

  async send(items: readonly PushNotificationInput[]): Promise<PushNotificationResult[]> {
    return Promise.all(items.map(async (item): Promise<PushNotificationResult> => {
      try {
        await webpush.sendNotification(item.subscription,
          JSON.stringify({ title: item.title, body: item.body, data: item.data }),
          { vapidDetails: this.vapid, timeout: 10_000 })
        return { id: item.id, ok: true }
      } catch (error) {
        const value = typeof error === 'object' && error !== null && 'statusCode' in error
          ? error.statusCode : undefined
        const status = typeof value === 'number' && Number.isInteger(value)
          && value >= 100 && value <= 599 ? value : 0
        return { id: item.id, ok: false, status, error: status === 0
          ? 'delivery_outcome_unknown' : `web_push_${status}` }
      }
    }))
  }
}
