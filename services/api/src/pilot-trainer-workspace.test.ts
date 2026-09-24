import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
import { DatabasePilotTrainerWorkspace } from './pilot-trainer-workspace.js'

class Connection implements DatabaseConnection {
  results: Array<readonly QueryResultRow[]> = []
  query<Row extends QueryResultRow = QueryResultRow>(): Promise<readonly Row[]> {
    return Promise.resolve((this.results.shift() ?? []) as readonly Row[])
  }
  release() {}
}

class Pool implements DatabasePool {
  connection = new Connection()
  connect() { return Promise.resolve(this.connection) }
  end() { return Promise.resolve() }
}

describe('DatabasePilotTrainerWorkspace', () => {
  it('matches the Today priority rules and counts every unresolved question', async () => {
    const pool = new Pool()
    pool.connection.results = [
      [],
      [{ profile_id: '10000000-0000-4000-8000-000000000001' }],
      [],
      [{ today: '2026-09-24' }],
      [{ id: 'client-a' }, { id: 'client-b' }, { id: 'client-c' }, { id: 'client-d' }, { id: 'client-e' }],
      [
        { workout_id: 'workout-q1', client_id: 'client-a', client_name: 'Анна', workout_date: '2026-09-20', client_question: 'Первый?', client_question_asked_at: '2026-09-24T08:00:00.000Z', discomfort: false },
        { workout_id: 'workout-q2', client_id: 'client-a', client_name: 'Анна', workout_date: '2026-09-21', client_question: 'Второй?', client_question_asked_at: '2026-09-24T09:00:00.000Z', discomfort: false },
        { workout_id: 'workout-d', client_id: 'client-b', client_name: 'Борис', workout_date: '2026-09-22', client_question: null, client_question_asked_at: null, discomfort: true },
      ],
      [
        { client_id: 'client-c', workout_date: '2026-09-25', status: 'planned' },
        { client_id: 'client-e', workout_date: '2026-09-10', status: 'done' },
      ],
      [{ client_id: 'client-d', attention_snoozed_until: new Date('2026-09-26T00:00:00.000Z') }],
      [{ unread_count: '3' }, { unread_count: 1 }],
      [],
    ]
    const workspace = new DatabasePilotTrainerWorkspace(pool, () => new Date('2026-09-24T10:00:00.000Z'))

    await expect(workspace.read({ accessMode: 'read_write', token: 'a'.repeat(43) })).resolves.toEqual({
      summary: {
        pendingActionCount: 3,
        unresolvedQuestionCount: 2,
        unreadChatMessageCount: 4,
        inboxCount: 6,
        updatedAt: '2026-09-24T10:00:00.000Z',
      },
      questions: [
        { workoutId: 'workout-q2', clientId: 'client-a', clientName: 'Анна', question: 'Второй?', askedAt: '2026-09-24T09:00:00.000Z' },
        { workoutId: 'workout-q1', clientId: 'client-a', clientName: 'Анна', question: 'Первый?', askedAt: '2026-09-24T08:00:00.000Z' },
      ],
    })
  })
})
