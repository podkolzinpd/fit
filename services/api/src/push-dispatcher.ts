import { dispatchStage } from './background-dispatch-error.js'
import type { DatabasePool } from './db/types.js'
import { withBackgroundTransaction } from './background-transaction.js'
import {
  claimPushNotifications,
  enqueueWorkoutReminders,
  finalizePushNotifications,
  type PushFinalizeSummary,
} from './push-dispatcher-command.js'
import type { PushNotificationSender } from './push-notifications/http-sender.js'
import type { PushNotificationResult } from './push-notifications/send.js'

export interface PushDispatchSummary extends PushFinalizeSummary {
  claimed: number
  remindersEnqueued: number
}

function unavailableResults(ids: readonly string[]): PushNotificationResult[] {
  return ids.map((id) => ({
    id,
    ok: false,
    status: 0,
    error: 'push_sender_unavailable',
  }))
}

export class PushDispatcher {
  constructor(
    private readonly pool: DatabasePool,
    private readonly sender: PushNotificationSender,
  ) {}

  async run(now = new Date()): Promise<PushDispatchSummary> {
    if (!Number.isFinite(now.getTime())) throw new Error('Push dispatch time is invalid')

    const prepared = await dispatchStage('push', 'prepare', () =>
      withBackgroundTransaction(this.pool, async (client) => {
        const remindersEnqueued = await enqueueWorkoutReminders(client, now)
        const batch = await claimPushNotifications(client, now)
        return { batch, remindersEnqueued }
      }))
    if (prepared.batch === null) {
      return {
        claimed: 0,
        discarded: 0,
        failed: 0,
        remindersEnqueued: prepared.remindersEnqueued,
        succeeded: 0,
      }
    }

    const batch = prepared.batch
    let results: PushNotificationResult[]
    try {
      results = await this.sender.send(batch.notifications)
    } catch {
      results = unavailableResults(
        batch.notifications.map((notification) => notification.id),
      )
    }

    const finalized = await dispatchStage('push', 'finalize', () =>
      withBackgroundTransaction(this.pool, (client) =>
        finalizePushNotifications(client, batch.dispatchToken, results, now)))
    return {
      claimed: batch.notifications.length,
      remindersEnqueued: prepared.remindersEnqueued,
      ...finalized,
    }
  }
}
