import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './types.js'
import { DatabaseFitLimePilotManager, FitLimePilotProfileNotReadyError } from './fit-lime-pilot.js'

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

describe('DatabaseFitLimePilotManager', () => {
  it.each([['enable', true], ['disable', false]] as const)('safely applies %s to an allowlisted trainer', async (action, enabled) => {
    const pool = new Pool()
    pool.connection.results = [
      [], [], [{ account_role: 'trainer', trainer_ready: true, pilot_allowed: true }],
      [], [{ enabled }], [{ enabled_rows: enabled ? 3 : 2 }], [],
    ]

    await expect(new DatabaseFitLimePilotManager(pool).apply(action, PROFILE_ID))
      .resolves.toEqual({ accountRole: 'trainer', enabled, enabledAllowlistRows: enabled ? 3 : 2 })
    expect(pool.connection.calls[3]?.values).toEqual([PROFILE_ID, enabled])
    expect(pool.connection.calls.at(-1)?.text).toBe('commit')
    expect(pool.connection.released).toBe(true)
  })

  it('inspects without changing the flag', async () => {
    const pool = new Pool()
    pool.connection.results = [
      [], [], [{ account_role: 'trainer', trainer_ready: true, pilot_allowed: true }],
      [{ enabled: false }], [{ enabled_rows: 1 }], [],
    ]
    await expect(new DatabaseFitLimePilotManager(pool).apply('inspect', PROFILE_ID))
      .resolves.toMatchObject({ enabled: false, enabledAllowlistRows: 1 })
    expect(pool.connection.calls.every(({ text }) => !text.includes('set enabled = $2'))).toBe(true)
  })

  it('rejects a trainer outside the three-account allowlist', async () => {
    const pool = new Pool()
    pool.connection.results = [[], [], [{ account_role: 'trainer', trainer_ready: true, pilot_allowed: false }], []]
    await expect(new DatabaseFitLimePilotManager(pool).apply('enable', PROFILE_ID))
      .rejects.toBeInstanceOf(FitLimePilotProfileNotReadyError)
    expect(pool.connection.calls.at(-1)?.text).toBe('rollback')
  })

  it('rolls back when the three-account invariant is violated', async () => {
    const pool = new Pool()
    pool.connection.results = [
      [], [], [{ account_role: 'trainer', trainer_ready: true, pilot_allowed: true }],
      [], [{ enabled: true }], [{ enabled_rows: 4 }], [],
    ]
    await expect(new DatabaseFitLimePilotManager(pool).apply('enable', PROFILE_ID))
      .rejects.toThrow('three-account invariant')
    expect(pool.connection.calls.at(-1)?.text).toBe('rollback')
  })
})
