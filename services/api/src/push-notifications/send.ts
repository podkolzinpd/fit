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
 * dispatcher posts here instead of calling the push service directly from
 * PostgreSQL.
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
    const status = Number.isFinite(statusCode) ? statusCode : 0
    return {
      id: input.id,
      ok: false,
      status,
      // Provider errors may contain a subscription endpoint. Return only a
      // stable code so neither the function response nor the outbox stores it.
      error: status === 0 ? 'web_push_failed' : `web_push_${status}`,
    }
  }
}

export async function sendPushNotifications(
  inputs: readonly PushNotificationInput[],
  vapid: VapidConfig,
): Promise<PushNotificationResult[]> {
  return Promise.all(inputs.map((input) => sendPushNotification(input, vapid)))
}
