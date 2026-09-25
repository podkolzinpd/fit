import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import {
  DatabaseTrainerScheduleV2PilotManager,
  TrainerScheduleV2PilotProfileNotReadyError,
} from './trainer-schedule-v2-pilot.js'
import type { DatabaseConnection, DatabasePool } from './types.js'

class Connection implements DatabaseConnection {
  calls: Array<{ text: string; values: readonly unknown[] }> = []
  results: Array<readonly QueryResultRow[]> = []
  released = false
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<readonly Row[]> {
    this.calls.push({ text, values })
    return Promise.resolve((this.results.shift() ?? []) as readonly Row[])
  }
  release() { this.released = true }
}

class Pool implements DatabasePool {
  connection = new Connection()
  connect() { return Promise.resolve(this.connection) }
  end() { return Promise.resolve() }
}

const PROFILE_ID = '10000000-0000-4000-8000-000000000001'

describe('DatabaseTrainerScheduleV2PilotManager', () => {
  it.each([['enable', true], ['disable', false]] as const)('applies a bounded %s assignment', async (action, enabled) => {
    const pool = new Pool()
    const enabledAssignments = enabled ? 2 : 1
    pool.connection.results = [
      [],
      [],
      [{ account_role: 'trainer', trainer_ready: true, pilot_allowed: true }],
      [],
      [],
      [{ enabled }],
      [{ enabled_assignments: String(enabledAssignments) }],
      [],
    ]
    const manager = new DatabaseTrainerScheduleV2PilotManager(pool)

    await expect(manager.apply(action, PROFILE_ID)).resolves.toEqual({
      accountRole: 'trainer',
      enabled,
      enabledAssignments,
    })
    expect(pool.connection.calls[3]?.text).toContain('update app_private.user_experiment_assignments')
    expect(pool.connection.calls[4]?.values).toEqual([PROFILE_ID, enabled])
    expect(pool.connection.calls.at(-1)?.text).toBe('commit')
    expect(pool.connection.released).toBe(true)
  })

  it('inspects without writing and defaults to disabled', async () => {
    const pool = new Pool()
    pool.connection.results = [
      [],
      [],
      [{ account_role: 'trainer', trainer_ready: true, pilot_allowed: true }],
      [],
      [{ enabled_assignments: 0 }],
      [],
    ]
    const manager = new DatabaseTrainerScheduleV2PilotManager(pool)

    await expect(manager.apply('inspect', PROFILE_ID)).resolves.toEqual({
      accountRole: 'trainer',
      enabled: false,
      enabledAssignments: 0,
    })
    expect(pool.connection.calls.every(({ text }) => !text.includes('insert into'))).toBe(true)
  })

  it('rejects a client profile and rolls back', async () => {
    const pool = new Pool()
    pool.connection.results = [
      [],
      [],
      [{ account_role: 'client', trainer_ready: false, pilot_allowed: false }],
      [],
    ]
    const manager = new DatabaseTrainerScheduleV2PilotManager(pool)

    await expect(manager.apply('enable', PROFILE_ID)).rejects.toBeInstanceOf(TrainerScheduleV2PilotProfileNotReadyError)
    expect(pool.connection.calls.at(-1)?.text).toBe('rollback')
  })

  it('rejects a trainer outside the reviewed two-account allowlist', async () => {
    const pool = new Pool()
    pool.connection.results = [
      [],
      [],
      [{ account_role: 'trainer', trainer_ready: true, pilot_allowed: false }],
      [],
    ]
    const manager = new DatabaseTrainerScheduleV2PilotManager(pool)

    await expect(manager.apply('enable', PROFILE_ID))
      .rejects.toBeInstanceOf(TrainerScheduleV2PilotProfileNotReadyError)
    expect(pool.connection.calls.at(-1)?.text).toBe('rollback')
  })

  it('rolls back when the two-account invariant is not satisfied', async () => {
    const pool = new Pool()
    pool.connection.results = [
      [],
      [],
      [{ account_role: 'trainer', trainer_ready: true, pilot_allowed: true }],
      [],
      [],
      [{ enabled: true }],
      [{ enabled_assignments: 3 }],
      [],
    ]
    const manager = new DatabaseTrainerScheduleV2PilotManager(pool)

    await expect(manager.apply('enable', PROFILE_ID)).rejects.toThrow('two-account invariant')
    expect(pool.connection.calls.at(-1)?.text).toBe('rollback')
  })
})
