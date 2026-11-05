import { backgroundDispatchDiagnostics, dispatchStage } from './background-dispatch-error.js'
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

    let remindersEnqueued = 0
    let producerFailed = false
    let producerFailure: unknown
    try {
      remindersEnqueued = await dispatchStage('push', 'prepare', () =>
        withBackgroundTransaction(this.pool, client =>
          diagnosePushQuery('reminder_enqueue', () => enqueueWorkoutReminders(client, now))))
    } catch (error) {
      producerFailed = true
      producerFailure = error
    }
    // A failed reminder transaction must not roll back or block delivery of
    // independently queued events. The database guard still excludes history.
    const batch = await dispatchStage('push', 'prepare', () =>
      withBackgroundTransaction(this.pool, client =>
        diagnosePushQuery('queue_claim', () => claimPushNotifications(client, now))))
    const finish = (summary: PushDispatchSummary): PushDispatchSummary => {
      if (producerFailed) {
        console.warn(JSON.stringify({ event: 'background_push_delivery_after_producer_failure', ...summary }))
        throw producerFailure
      }
      return summary
    }
    if (batch === null) {
      return finish({
        claimed: 0,
        discarded: 0,
        failed: 0,
        remindersEnqueued,
        succeeded: 0,
      })
    }

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
    return finish({
      claimed: batch.notifications.length,
      remindersEnqueued,
      ...finalized,
    })
  }
}

async function diagnosePushQuery<Result>(step: 'reminder_enqueue' | 'queue_claim', work: () => Promise<Result>): Promise<Result> {
  try { return await work() } catch (error) {
    console.warn(JSON.stringify({ event: 'background_push_query_failed', step, ...backgroundDispatchDiagnostics(error) }))
    throw error
  }
}
