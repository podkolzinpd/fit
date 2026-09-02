import type { QueryResultRow } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DatabaseConnection,
  DatabasePool,
} from './db/types.js'

const commandMocks = vi.hoisted(() => ({
  claimPushNotifications: vi.fn(),
  enqueueWorkoutReminders: vi.fn(),
  finalizePushNotifications: vi.fn(),
}))
vi.mock('./push-dispatcher-command.js', () => commandMocks)

const { PushDispatcher } = await import('./push-dispatcher.js')

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

const notification = {
  id: '780e135d-b64e-4415-a934-3c649236808b',
  subscription: {
    endpoint: 'https://push.example/subscription',
    keys: { p256dh: 'public-key', auth: 'auth-key' },
  },
  title: 'Тренировка сегодня',
  body: 'Запланирована на 09:00',
  data: { workout_id: '436af949-dd4e-4263-bc8a-56dd22f1a635' },
}

beforeEach(() => {
  commandMocks.claimPushNotifications.mockReset()
  commandMocks.enqueueWorkoutReminders.mockReset()
  commandMocks.finalizePushNotifications.mockReset()
})

describe('PushDispatcher', () => {
  it('produces, claims, sends and finalizes one bounded batch', async () => {
    const pool = new TransactionPool()
    commandMocks.enqueueWorkoutReminders.mockResolvedValueOnce(2)
    commandMocks.claimPushNotifications.mockResolvedValueOnce({
      dispatchToken: '6a94ce95-ebfc-4d2f-8a30-c66ea8b0ab95',
      notifications: [notification],
    })
    commandMocks.finalizePushNotifications.mockResolvedValueOnce({
      succeeded: 1,
      failed: 0,
      discarded: 0,
    })
    const sender = {
      send: vi.fn(() => Promise.resolve([
        { id: notification.id, ok: true as const },
      ])),
    }
    const dispatcher = new PushDispatcher(pool, sender)
    const now = new Date('2026-09-02T09:02:00.000Z')

    await expect(dispatcher.run(now)).resolves.toEqual({
      claimed: 1,
      discarded: 0,
      failed: 0,
      remindersEnqueued: 2,
      succeeded: 1,
    })
    expect(sender.send).toHaveBeenCalledWith([notification])
    expect(commandMocks.finalizePushNotifications).toHaveBeenCalledWith(
      expect.anything(),
      '6a94ce95-ebfc-4d2f-8a30-c66ea8b0ab95',
      [{ id: notification.id, ok: true }],
      now,
    )
    expect(pool.connections.map((connection) => connection.queries)).toEqual([
      ['begin', 'commit'],
      ['begin', 'commit'],
    ])
    expect(pool.connections.every((connection) => connection.released)).toBe(true)
  })

  it('does not call the sender when the outbox is empty', async () => {
    const pool = new TransactionPool()
    commandMocks.enqueueWorkoutReminders.mockResolvedValueOnce(0)
    commandMocks.claimPushNotifications.mockResolvedValueOnce(null)
    const sender = { send: vi.fn() }

    await expect(new PushDispatcher(pool, sender).run()).resolves.toEqual({
      claimed: 0,
      discarded: 0,
      failed: 0,
      remindersEnqueued: 0,
      succeeded: 0,
    })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('rolls back and releases the connection when preparation fails', async () => {
    const pool = new TransactionPool()
    commandMocks.enqueueWorkoutReminders.mockRejectedValueOnce(
      new Error('producer failed'),
    )
    const sender = { send: vi.fn() }

    await expect(new PushDispatcher(pool, sender).run()).rejects.toThrow(
      'producer failed',
    )
    expect(sender.send).not.toHaveBeenCalled()
    expect(pool.connections.map((connection) => connection.queries)).toEqual([
      ['begin', 'rollback'],
    ])
    expect(pool.connections[0]?.released).toBe(true)
  })

  it('releases every claimed row through bounded failure finalization', async () => {
    const pool = new TransactionPool()
    commandMocks.enqueueWorkoutReminders.mockResolvedValueOnce(0)
    commandMocks.claimPushNotifications.mockResolvedValueOnce({
      dispatchToken: '6a94ce95-ebfc-4d2f-8a30-c66ea8b0ab95',
      notifications: [notification],
    })
    commandMocks.finalizePushNotifications.mockResolvedValueOnce({
      succeeded: 0,
      failed: 1,
      discarded: 0,
    })
    const sender = {
      send: vi.fn(() => Promise.reject(new Error('network'))),
    }

    await expect(new PushDispatcher(pool, sender).run()).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    })
    expect(commandMocks.finalizePushNotifications).toHaveBeenCalledWith(
      expect.anything(),
      '6a94ce95-ebfc-4d2f-8a30-c66ea8b0ab95',
      [{
        id: notification.id,
        ok: false,
        status: 0,
        error: 'push_sender_unavailable',
      }],
      expect.any(Date),
    )
  })
})
