import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

import type { DatabaseClient, DatabasePool } from './db/types.js'
import { encryptDatabaseDump } from './cloud-database-transfer.js'

const SCHEMAS = ['app_private', 'private', 'public'] as const
const MAX_ENCRYPTED_CHUNK_BYTES = 3_000_000
const MAX_ROWS_PER_CHUNK = 500
const TABLE_NAME = /^[a-z][a-z0-9_]*$/u

export interface SqlSnapshotTable {
  schema: string
  table: string
  rows: number
  sha256: string
}

export interface SqlSnapshotManifest {
  format: 'fit-cloudru-sql-snapshot-v1'
  tables: SqlSnapshotTable[]
}

interface TableNameRow {
  schema: string
  table: string
}

interface SerializedRow {
  row: string
}

export class SqlSnapshotError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'SqlSnapshotError'
  }
}

function identifier(value: string): string {
  if (!TABLE_NAME.test(value)) throw new SqlSnapshotError('sql_table_invalid')
  return `"${value}"`
}

function tableReference(schema: string, table: string): string {
  if (!SCHEMAS.some((allowed) => allowed === schema)) {
    throw new SqlSnapshotError('sql_schema_invalid')
  }
  return `${identifier(schema)}.${identifier(table)}`
}

async function listTables(connection: DatabaseClient): Promise<readonly TableNameRow[]> {
  return connection.query<TableNameRow>(`select schemaname as schema, relname as table
    from pg_stat_user_tables
    where schemaname in ('app_private', 'private', 'public')
      and not (schemaname = 'app_private' and relname = 'fit_migrations')
    order by schemaname, relname`)
}

async function assertListedTable(
  connection: DatabaseClient,
  schema: string,
  table: string,
): Promise<void> {
  const listed = await listTables(connection)
  if (!listed.some((candidate) => candidate.schema === schema && candidate.table === table)) {
    throw new SqlSnapshotError('sql_table_not_found')
  }
}

export class YandexSqlSnapshotSource {
  constructor(private readonly pool: DatabasePool) {}

  async manifest(): Promise<SqlSnapshotManifest> {
    const connection = await this.pool.connect()
    try {
      await connection.query('begin isolation level repeatable read read only')
      await connection.query("set local timezone to 'UTC'")
      await connection.query("set local bytea_output to 'hex'")
      const names = await listTables(connection)
      const tables: SqlSnapshotTable[] = []
      for (const name of names) {
        const reference = tableReference(name.schema, name.table)
        const rows = await connection.query<SerializedRow>(
          `select row_to_json(record)::text as row from ${reference} record
            order by row_to_json(record)::text collate "C"`,
        )
        const hash = createHash('sha256')
        for (const { row } of rows) hash.update(row).update('\n')
        tables.push({
          schema: name.schema,
          table: name.table,
          rows: rows.length,
          sha256: hash.digest('hex'),
        })
      }
      await connection.query('commit')
      return { format: 'fit-cloudru-sql-snapshot-v1', tables }
    } catch (error) {
      await connection.query('rollback').catch(() => undefined)
      throw error
    } finally {
      connection.release()
    }
  }

  async chunk(
    schema: string,
    table: string,
    offset: number,
    limit: number,
    passphrase: string,
  ): Promise<Buffer> {
    if (!Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ROWS_PER_CHUNK) {
      throw new SqlSnapshotError('sql_chunk_range_invalid')
    }
    const reference = tableReference(schema, table)
    const connection = await this.pool.connect()
    try {
      await connection.query('begin isolation level repeatable read read only')
      await connection.query("set local timezone to 'UTC'")
      await connection.query("set local bytea_output to 'hex'")
      await assertListedTable(connection, schema, table)
      const rows = await connection.query<SerializedRow>(
        `select row_to_json(record)::text as row from ${reference} record
          order by row_to_json(record)::text collate "C" limit $1 offset $2`,
        [limit, offset],
      )
      await connection.query('commit')
      const compressed = gzipSync(Buffer.from(JSON.stringify({
        format: 'fit-cloudru-sql-chunk-v1',
        schema,
        table,
        offset,
        rows: rows.map((entry) => entry.row),
      })))
      const encrypted = await encryptDatabaseDump(compressed, passphrase)
      if (encrypted.byteLength > MAX_ENCRYPTED_CHUNK_BYTES) {
        throw new SqlSnapshotError('sql_chunk_too_large')
      }
      return encrypted
    } catch (error) {
      await connection.query('rollback').catch(() => undefined)
      throw error
    } finally {
      connection.release()
    }
  }
}
