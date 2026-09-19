import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import { fingerprintTenant } from '../tenant-migration/bundle.js'
import { DatabaseYandexIdentityUnlinkManager } from './yandex-identity-unlink.js'
import type { DatabaseConnection, DatabasePool } from './types.js'

class RecordingConnection implements DatabaseConnection {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = []
  released = false
  results: Array<readonly QueryResultRow[]> = []

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<readonly Row[]> {
    this.calls.push({ text, values })
    return Promise.resolve((this.results.shift() ?? []) as readonly Row[])
  }

  release(): void {
    this.released = true
  }
}

class FailingConnection extends RecordingConnection {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<readonly Row[]> {
    this.calls.push({ text, values })
    if (text.includes('delete from app_private.auth_identities')) {
      return Promise.reject(new Error('delete failed'))
    }
    return Promise.resolve((this.results.shift() ?? []) as readonly Row[])
  }
}

class RecordingPool implements DatabasePool {
  constructor(readonly connection: RecordingConnection = new RecordingConnection()) {}

  connect(): Promise<DatabaseConnection> {
    return Promise.resolve(this.connection)
  }

  end(): Promise<void> {
    return Promise.resolve()
  }
}

const PROFILE_ID = '10000000-0000-4000-8000-000000000001'

describe('DatabaseYandexIdentityUnlinkManager', () => {
  it('deletes the Yandex identity and revokes active sessions in one transaction', async () => {
    const pool = new RecordingPool()
    pool.connection.results = [
      [],
      [],
      [{ count: '1' }],
      [{ count: '3' }],
      [],
    ]
    const manager = new DatabaseYandexIdentityUnlinkManager(pool)

    await expect(manager.unlink({ profileId: PROFILE_ID })).resolves.toEqual({
      identityDeleted: true,
      sessionsRevoked: 3,
    })

    expect(pool.connection.calls[0]?.text).toBe('begin')
    expect(pool.connection.calls[1]?.text).toContain('pg_advisory_xact_lock')
    expect(pool.connection.calls[1]?.values).toEqual([PROFILE_ID])
    expect(pool.connection.calls[2]?.text).toContain(
      'delete from app_private.auth_identities',
    )
    expect(pool.connection.calls[2]?.values).toEqual([PROFILE_ID])
    expect(pool.connection.calls[3]?.text).toContain(
      'update app_private.yandex_app_sessions',
    )
    expect(pool.connection.calls[3]?.values).toEqual([PROFILE_ID])
    expect(pool.connection.calls[4]?.text).toBe('commit')
    expect(pool.connection.released).toBe(true)
  })

  it('keeps the operation idempotent when the profile is already unlinked', async () => {
    const pool = new RecordingPool()
    pool.connection.results = [
      [],
      [],
      [{ count: '0' }],
      [{ count: '0' }],
      [],
    ]
    const manager = new DatabaseYandexIdentityUnlinkManager(pool)

    await expect(manager.unlink({ profileId: PROFILE_ID })).resolves.toEqual({
      identityDeleted: false,
      sessionsRevoked: 0,
    })
    expect(pool.connection.calls[4]?.text).toBe('commit')
  })

  it('rolls back and releases the connection on a failed unlink', async () => {
    const pool = new RecordingPool(new FailingConnection())
    const manager = new DatabaseYandexIdentityUnlinkManager(pool)

    await expect(manager.unlink({ profileId: PROFILE_ID })).rejects.toThrow('delete failed')

    expect(pool.connection.calls.at(-1)?.text).toBe('rollback')
    expect(pool.connection.released).toBe(true)
  })

  it('resolves the profile from a non-reversible tenant fingerprint', async () => {
    const pool = new RecordingPool()
    pool.connection.results = [
      [],
      [{ id: PROFILE_ID, account_role: 'trainer' }],
      [],
      [{ count: '1' }],
      [{ count: '1' }],
      [],
    ]
    const manager = new DatabaseYandexIdentityUnlinkManager(pool)

    await expect(manager.unlink({
      tenantFingerprint: fingerprintTenant(PROFILE_ID),
    })).resolves.toEqual({
      identityDeleted: true,
      sessionsRevoked: 1,
    })

    expect(pool.connection.calls[1]?.text).toContain('from public.profiles')
    expect(pool.connection.calls[3]?.values).toEqual([PROFILE_ID])
  })
})
