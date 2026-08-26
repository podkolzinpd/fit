import webpush from 'web-push'

export type PushSubscriptionInput = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export type PushNotificationInput = {
  id: string
  subscription: PushSubscriptionInput
  title: string
  body: string
  data: Record<string, unknown>
}

export type PushNotificationResult =
  | { id: string; ok: true }
  | { id: string; ok: false; status: number; error: string }

export type VapidConfig = {
  publicKey: string
  privateKey: string
  subject: string
}

/**
 * web-push does the ECDH/AEAD payload encryption and VAPID JWT signing per
 * subscription — this cannot be done in plain SQL, which is why the outbox
 * dispatcher (private.dispatch_push_notifications) posts here instead of
 * calling the push service directly like the Tracker/Telegram sync do.
 */
export async function sendPushNotification(
  input: PushNotificationInput,
  vapid: VapidConfig,
): Promise<PushNotificationResult> {
  try {
    await webpush.sendNotification(
      input.subscription,
      JSON.stringify({ title: input.title, body: input.body, data: input.data }),
      {
        vapidDetails: {
          subject: vapid.subject,
          publicKey: vapid.publicKey,
          privateKey: vapid.privateKey,
        },
      },
    )
    return { id: input.id, ok: true }
  } catch (error) {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number(error.statusCode)
      : 0
    const message = error instanceof Error ? error.message : String(error)
    return { id: input.id, ok: false, status: Number.isFinite(statusCode) ? statusCode : 0, error: message.slice(0, 500) }
  }
}

export async function sendPushNotifications(
  inputs: readonly PushNotificationInput[],
  vapid: VapidConfig,
): Promise<PushNotificationResult[]> {
  return Promise.all(inputs.map((input) => sendPushNotification(input, vapid)))
}
