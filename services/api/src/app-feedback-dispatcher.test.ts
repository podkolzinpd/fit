import type { QueryResultRow } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'

const commandMocks = vi.hoisted(() => ({
  claimAppFeedbackDeliveries: vi.fn(),
  finalizeAppFeedbackDeliveries: vi.fn(),
}))
vi.mock('./app-feedback-dispatcher-command.js', () => commandMocks)

const { AppFeedbackDispatcher } = await import('./app-feedback-dispatcher.js')

class TransactionConnection implements DatabaseConnection {
  readonly queries: string[] = []
  released = false

  query<Row extends QueryResultRow>(text: string): Promise<readonly Row[]> {
    this.queries.push(text)
    return Promise.resolve([])
  }

  release(): void {
    this.released = true
  }
}

class TransactionPool implements DatabasePool {
  readonly connections: TransactionConnection[] = []

  connect(): Promise<DatabaseConnection> {
    const connection = new TransactionConnection()
    this.connections.push(connection)
    return Promise.resolve(connection)
  }

  async end(): Promise<void> {}
}

const delivery = {
  id: '780e135d-b64e-4415-a934-3c649236808b',
  accountRole: 'trainer' as const,
  kind: 'problem' as const,
  message: 'Проверка dispatcher',
  screenPath: '/trainer',
  appVersion: 'release-1',
  displayMode: 'browser' as const,
  createdAt: '2026-09-04T12:00:00.000Z',
  sendTracker: true,
  sendTelegram: true,
}

beforeEach(() => {
  commandMocks.claimAppFeedbackDeliveries.mockReset()
  commandMocks.finalizeAppFeedbackDeliveries.mockReset()
})

describe('AppFeedbackDispatcher', () => {
  it('claims, sends and finalizes one batch in bounded transactions', async () => {
    const pool = new TransactionPool()
    const now = new Date('2026-09-04T12:01:00.000Z')
    commandMocks.claimAppFeedbackDeliveries.mockResolvedValueOnce({
      dispatchToken: '6a94ce95-ebfc-4d2f-8a30-c66ea8b0ab95',
      deliveries: [delivery],
    })
    commandMocks.finalizeAppFeedbackDeliveries.mockResolvedValueOnce({
      trackerSucceeded: 1,
      trackerFailed: 0,
      trackerDiscarded: 0,
      telegramSucceeded: 1,
      telegramFailed: 0,
      telegramDiscarded: 0,
    })
    const results = [{
      id: delivery.id,
      tracker: { ok: true as const, issueKey: 'YAFIT-42' },
      telegram: { ok: true as const },
    }]
    const sender = { send: vi.fn(() => Promise.resolve(results)) }

    await expect(new AppFeedbackDispatcher(pool, sender).run(now)).resolves.toEqual({
      claimed: 1,
      trackerSucceeded: 1,
      trackerFailed: 0,
      trackerDiscarded: 0,
      telegramSucceeded: 1,
      telegramFailed: 0,
      telegramDiscarded: 0,
    })
    expect(sender.send).toHaveBeenCalledWith([delivery])
    expect(commandMocks.finalizeAppFeedbackDeliveries).toHaveBeenCalledWith(
      expect.anything(),
      '6a94ce95-ebfc-4d2f-8a30-c66ea8b0ab95',
      results,
      now,
    )
    expect(pool.connections.map((connection) => connection.queries)).toEqual([
      ['begin', 'commit'],
      ['begin', 'commit'],
    ])
  })

  it('does not call providers when no feedback is pending', async () => {
    const pool = new TransactionPool()
    commandMocks.claimAppFeedbackDeliveries.mockResolvedValueOnce(null)
    const sender = { send: vi.fn() }

    await expect(new AppFeedbackDispatcher(pool, sender).run()).resolves.toEqual({
      claimed: 0,
      trackerSucceeded: 0,
      trackerFailed: 0,
      trackerDiscarded: 0,
      telegramSucceeded: 0,
      telegramFailed: 0,
      telegramDiscarded: 0,
    })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('finalizes stable provider failures when the sender is unavailable', async () => {
    const pool = new TransactionPool()
    commandMocks.claimAppFeedbackDeliveries.mockResolvedValueOnce({
      dispatchToken: '6a94ce95-ebfc-4d2f-8a30-c66ea8b0ab95',
      deliveries: [delivery],
    })
    commandMocks.finalizeAppFeedbackDeliveries.mockResolvedValueOnce({
      trackerSucceeded: 0,
      trackerFailed: 1,
      trackerDiscarded: 0,
      telegramSucceeded: 0,
      telegramFailed: 1,
      telegramDiscarded: 0,
    })
    const sender = { send: vi.fn(() => Promise.reject(new Error('private'))) }

    await new AppFeedbackDispatcher(pool, sender).run()
    expect(commandMocks.finalizeAppFeedbackDeliveries).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      [{
        id: delivery.id,
        tracker: { ok: false, error: 'tracker_unavailable' },
        telegram: { ok: false, error: 'telegram_unavailable' },
      }],
      expect.any(Date),
    )
  })
})
