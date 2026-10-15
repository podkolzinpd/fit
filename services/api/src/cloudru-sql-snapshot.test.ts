import { gunzipSync } from 'node:zlib'

import { describe, expect, it, vi } from 'vitest'

import { decryptDatabaseDump } from './cloud-database-transfer.js'
import { YandexSqlSnapshotSource } from './cloudru-sql-snapshot.js'
import type { DatabaseClient, DatabasePool } from './db/types.js'

const PASSPHRASE = 'sql-snapshot-test-passphrase-is-long-enough'
const PROFILE = '{"id":"12345678-1234-4123-8123-123456789abc","name":"Test"}'

function source(): { service: YandexSqlSnapshotSource; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn((sql: string) => {
    if (sql.includes('from pg_stat_user_tables')) {
      return Promise.resolve([{ schema: 'public', table: 'profiles' }])
    }
    if (sql.includes('row_to_json(record)')) return Promise.resolve([{ row: PROFILE }])
    return Promise.resolve([])
  })
  const connection: DatabaseClient & { release: () => void } = {
    query: query as DatabaseClient['query'],
    release: vi.fn(),
  }
  const pool: DatabasePool = {
    connect: vi.fn().mockResolvedValue(connection),
    end: vi.fn().mockResolvedValue(undefined),
  }
  return { service: new YandexSqlSnapshotSource(pool), query }
}

describe('Yandex SQL snapshot source', () => {
  it('reads a consistent, exact table manifest without returning row contents', async () => {
    const { service, query } = source()
    const manifest = await service.manifest()

    expect(manifest.format).toBe('fit-cloudru-sql-snapshot-v1')
    expect(manifest.tables).toHaveLength(1)
    expect(manifest.tables[0]?.schema).toBe('public')
    expect(manifest.tables[0]?.table).toBe('profiles')
    expect(manifest.tables[0]?.rows).toBe(1)
    expect(manifest.tables[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.stringify(manifest)).not.toContain('Test')
    expect(query).toHaveBeenCalledWith('begin isolation level repeatable read read only')
    expect(query).toHaveBeenCalledWith('commit')
  })

  it('encrypts a bounded SQL row chunk and rejects arbitrary tables', async () => {
    const { service } = source()
    const encrypted = await service.chunk('public', 'profiles', 0, 1, PASSPHRASE)
    const decrypted = JSON.parse(gunzipSync(
      await decryptDatabaseDump(encrypted, PASSPHRASE),
    ).toString('utf8')) as unknown
    expect(decrypted).toEqual({
      format: 'fit-cloudru-sql-chunk-v1',
      schema: 'public',
      table: 'profiles',
      offset: 0,
      rows: [PROFILE],
    })
    await expect(service.chunk('public', 'unknown', 0, 1, PASSPHRASE))
      .rejects.toThrow('sql_table_not_found')
    await expect(service.chunk('public', 'profiles;drop', 0, 1, PASSPHRASE))
      .rejects.toThrow('sql_table_invalid')
  })
})
