import type { QueryResultRow } from 'pg'

import type { DatabasePool } from './db/types.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/

interface BindingRow extends QueryResultRow {
  bound: boolean
}

export interface FitLimeAutoActivator {
  bind(subjectHash: string, loginHash: string): Promise<{ bound: boolean }>
}

export class DatabaseFitLimeAutoActivator implements FitLimeAutoActivator {
  constructor(private readonly pool: DatabasePool) {}

  async bind(subjectHash: string, loginHash: string): Promise<{ bound: boolean }> {
    if (!SHA256_PATTERN.test(subjectHash) || !SHA256_PATTERN.test(loginHash)) {
      return { bound: false }
    }

    const connection = await this.pool.connect()
    try {
      const rows = await connection.query<BindingRow>(
        `select app_private.bind_fit_lime_for_yandex_login($1, $2) as bound`,
        [subjectHash, loginHash],
      )
      return { bound: rows[0]?.bound === true }
    } finally {
      connection.release()
    }
  }
}
