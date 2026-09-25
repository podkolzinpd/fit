import type { QueryResultRow } from 'pg'

import type { DatabasePool } from './db/types.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/

interface ActivationRow extends QueryResultRow {
  activated: boolean
}

export interface TrainerScheduleV2AutoActivator {
  activate(subjectHash: string, loginHash: string): Promise<{ activated: boolean }>
}

export class DatabaseTrainerScheduleV2AutoActivator
implements TrainerScheduleV2AutoActivator {
  constructor(private readonly pool: DatabasePool) {}

  async activate(
    subjectHash: string,
    loginHash: string,
  ): Promise<{ activated: boolean }> {
    if (!SHA256_PATTERN.test(subjectHash) || !SHA256_PATTERN.test(loginHash)) {
      return { activated: false }
    }

    const connection = await this.pool.connect()
    try {
      const rows = await connection.query<ActivationRow>(
        `select app_private.activate_trainer_schedule_v2_for_yandex_login(
           $1, $2
         ) as activated`,
        [subjectHash, loginHash],
      )
      return { activated: rows[0]?.activated === true }
    } finally {
      connection.release()
    }
  }
}
