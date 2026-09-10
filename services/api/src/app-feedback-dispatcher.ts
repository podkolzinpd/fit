import {
  claimAppFeedbackDeliveries,
  finalizeAppFeedbackDeliveries,
  type AppFeedbackFinalizeSummary,
} from './app-feedback-dispatcher-command.js'
import type {
  AppFeedbackDeliveryResult,
  AppFeedbackSender,
} from './app-feedback-integrations/sender.js'
import type { DatabaseClient, DatabasePool } from './db/types.js'

export interface AppFeedbackDispatchSummary extends AppFeedbackFinalizeSummary {
  claimed: number
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
          'App feedback transaction and rollback both failed',
          { cause: rollbackError },
        )
      }
    }
    throw error
  } finally {
    connection.release()
  }
}

function unavailableResults(
  deliveries: readonly {
    id: string
    sendTracker: boolean
    sendTelegram: boolean
  }[],
): AppFeedbackDeliveryResult[] {
  return deliveries.map((delivery) => ({
    id: delivery.id,
    ...(delivery.sendTracker
      ? { tracker: { ok: false as const, error: 'tracker_unavailable' } }
      : {}),
    ...(delivery.sendTelegram
      ? { telegram: { ok: false as const, error: 'telegram_unavailable' } }
      : {}),
  }))
}

export class AppFeedbackDispatcher {
  constructor(
    private readonly pool: DatabasePool,
    private readonly sender: AppFeedbackSender,
  ) {}

  async run(now = new Date()): Promise<AppFeedbackDispatchSummary> {
    if (!Number.isFinite(now.getTime())) {
      throw new Error('App feedback dispatch time is invalid')
    }
    const batch = await withTransaction(this.pool, (client) =>
      claimAppFeedbackDeliveries(client, now))
    if (batch === null) {
      return {
        claimed: 0,
        trackerSucceeded: 0,
        trackerFailed: 0,
        trackerDiscarded: 0,
        telegramSucceeded: 0,
        telegramFailed: 0,
        telegramDiscarded: 0,
      }
    }

    let results: AppFeedbackDeliveryResult[]
    try {
      results = await this.sender.send(batch.deliveries)
    } catch {
      results = unavailableResults(batch.deliveries)
    }
    const finalized = await withTransaction(this.pool, (client) =>
      finalizeAppFeedbackDeliveries(
        client,
        batch.dispatchToken,
        results,
        now,
      ))
    return { claimed: batch.deliveries.length, ...finalized }
  }
}
