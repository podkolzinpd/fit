import type { QueryResultRow } from 'pg'

import type { DatabasePool } from './types.js'

export type StageDatabaseReaderAccessAction = 'grant' | 'revoke'

export interface StageDatabaseReaderAccessManager {
  setAccess(
    action: StageDatabaseReaderAccessAction,
    databaseUsername: string,
  ): Promise<void>
}

interface AccessResultRow extends QueryResultRow {
  applied: boolean
}

function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  return typeof error.code === 'string' ? error.code : undefined
}

export class StageDatabaseReaderNotReadyError extends Error {
  constructor() {
    super('The database user is missing or cannot receive read-only access')
    this.name = 'StageDatabaseReaderNotReadyError'
  }
}

export class DatabaseStageDatabaseReaderAccessManager
implements StageDatabaseReaderAccessManager {
  constructor(private readonly pool: DatabasePool) {}

  async setAccess(
    action: StageDatabaseReaderAccessAction,
    databaseUsername: string,
  ): Promise<void> {
    const connection = await this.pool.connect()

    try {
      const rows = await connection.query<AccessResultRow>(
        `select app_private.set_ops_readonly_access($1, $2) as applied`,
        [databaseUsername, action === 'grant'],
      )
      if (rows[0]?.applied !== true) {
        throw new Error('Database reader access was not applied')
      }
    } catch (error) {
      if (databaseErrorCode(error) === '42704'
        || databaseErrorCode(error) === '42501') {
        throw new StageDatabaseReaderNotReadyError()
      }
      throw error
    } finally {
      connection.release()
    }
  }
}
