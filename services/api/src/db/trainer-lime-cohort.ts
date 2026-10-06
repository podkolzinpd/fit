import type { QueryResultRow } from 'pg'

import type { DatabasePool } from './types.js'

export interface TrainerLimeCohortResult {
  approvedRows: number
  added: boolean
}

export interface TrainerLimeCohortManager {
  enroll(loginSha256: string): Promise<TrainerLimeCohortResult>
}

interface CohortRow extends QueryResultRow {
  approved_rows: number
  added: boolean
}

// Used exclusively by the existing IAM-protected migration owner connection.
export class DatabaseTrainerLimeCohortManager implements TrainerLimeCohortManager {
  constructor(private readonly pool: DatabasePool) {}

  async enroll(loginSha256: string): Promise<TrainerLimeCohortResult> {
    if (!/^[0-9a-f]{64}$/.test(loginSha256)) throw new Error('Invalid reviewed trainer key')
    const connection = await this.pool.connect()
    try {
      const rows = await connection.query<CohortRow>(
        'select * from app_private.add_reviewed_trainer_lime_login($1)', [loginSha256],
      )
      const row = rows[0]
      if (rows.length !== 1 || row === undefined || (row.approved_rows !== 2 && row.approved_rows !== 3)) {
        throw new Error('Reviewed trainer cohort invariant failed')
      }
      return { approvedRows: row.approved_rows, added: row.added }
    } finally {
      connection.release()
    }
  }
}
