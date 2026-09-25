import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
import {
  DatabaseTrainerScheduleV2Claimer,
  TrainerScheduleV2ClaimError,
} from './trainer-schedule-v2-claim.js'

class Connection implements DatabaseConnection {
  calls: Array<{ text: string; values: readonly unknown[] }> = []
  results: Array<readonly QueryResultRow[]> = []
  released = false

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<readonly Row[]> {
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

const SESSION = { accessMode: 'read_write' as const, token: 's'.repeat(43) }
const CLAIM_TOKEN = 'c'.repeat(43)
const PROFILE_ID = '10000000-0000-4000-8000-000000000001'

describe('DatabaseTrainerScheduleV2Claimer', () => {
  it('consumes the token without disabling the other reviewed trainer', async () => {
    const pool = new Pool()
    pool.connection.results = [
      [],
      [{ profile_id: PROFILE_ID }],
      [],
      [],
      [{ token_hash: 'valid' }],
      [{ account_role: 'trainer', trainer_ready: true, pilot_allowed: true }],
      [],
      [],
      [],
      [{ enabled_assignments: '2' }],
      [],
    ]

    await expect(new DatabaseTrainerScheduleV2Claimer(pool).claim(SESSION, CLAIM_TOKEN))
      .resolves.toEqual({ enabled: true })
    expect(pool.connection.calls.some(({ text }) => text.includes('consumed_by = auth.uid()'))).toBe(true)
    expect(pool.connection.calls.some(({ text }) => text.includes("set enabled = false"))).toBe(true)
    expect(pool.connection.calls.at(-1)?.text).toBe('commit')
    expect(pool.connection.released).toBe(true)
  })

  it('rejects an expired or already consumed token without changing assignments', async () => {
    const pool = new Pool()
    pool.connection.results = [[], [{ profile_id: PROFILE_ID }], [], [], [], []]

    await expect(new DatabaseTrainerScheduleV2Claimer(pool).claim(SESSION, CLAIM_TOKEN))
      .rejects.toMatchObject({ failure: 'invalid_token' })
    expect(pool.connection.calls.some(({ text }) => text.includes('user_experiment_assignments'))).toBe(false)
    expect(pool.connection.calls.at(-1)?.text).toBe('rollback')
  })

  it('does not allow a client profile to consume the trainer activation', async () => {
    const pool = new Pool()
    pool.connection.results = [
      [],
      [{ profile_id: PROFILE_ID }],
      [],
      [],
      [{ token_hash: 'valid' }],
      [{ account_role: 'client', trainer_ready: false, pilot_allowed: false }],
      [],
    ]

    await expect(new DatabaseTrainerScheduleV2Claimer(pool).claim(SESSION, CLAIM_TOKEN))
      .rejects.toMatchObject({ failure: 'profile_not_ready' })
    expect(pool.connection.calls.some(({ text }) => text.includes('consumed_by = auth.uid()'))).toBe(false)
    expect(pool.connection.calls.at(-1)?.text).toBe('rollback')
  })

  it('does not allow a trainer outside the reviewed two-account allowlist', async () => {
    const pool = new Pool()
    pool.connection.results = [
      [],
      [{ profile_id: PROFILE_ID }],
      [],
      [],
      [{ token_hash: 'valid' }],
      [{ account_role: 'trainer', trainer_ready: true, pilot_allowed: false }],
      [],
    ]

    await expect(new DatabaseTrainerScheduleV2Claimer(pool).claim(SESSION, CLAIM_TOKEN))
      .rejects.toMatchObject({ failure: 'profile_not_ready' })
    expect(pool.connection.calls.some(({ text }) => text.includes('consumed_by = auth.uid()'))).toBe(false)
    expect(pool.connection.calls.at(-1)?.text).toBe('rollback')
  })

  it('requires a read-write Yandex app session', () => {
    const pool = new Pool()
    expect(() => new DatabaseTrainerScheduleV2Claimer(pool).claim(
      { accessMode: 'read_only', token: 's'.repeat(43) },
      CLAIM_TOKEN,
    )).toThrow(TrainerScheduleV2ClaimError)
  })
})
