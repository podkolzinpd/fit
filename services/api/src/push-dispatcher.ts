import type { DatabaseClient, DatabasePool } from './db/types.js'
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

async function withTransaction<Result>(
  pool: DatabasePool,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  const connection = await pool.connect()
  let transactionStarted = false
  try {
    await connection.query('begin')
    transactionStarted = true
    const result = await work(connection)
    await connection.query('commit')
    return result
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.query('rollback')
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Push dispatcher transaction and rollback both failed',
          { cause: rollbackError },
        )
      }
    }
    throw error
  } finally {
    connection.release()
  }
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

    const prepared = await withTransaction(this.pool, async (client) => {
      const remindersEnqueued = await enqueueWorkoutReminders(client, now)
      const batch = await claimPushNotifications(client, now)
      return { batch, remindersEnqueued }
    })
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

    const finalized = await withTransaction(this.pool, (client) =>
      finalizePushNotifications(
        client,
        batch.dispatchToken,
        results,
        now,
      ))
    return {
      claimed: batch.notifications.length,
      remindersEnqueued: prepared.remindersEnqueued,
      ...finalized,
    }
  }
}
