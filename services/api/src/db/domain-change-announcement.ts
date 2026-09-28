import type { QueryResultRow } from 'pg'

import type { DatabasePool } from './types.js'

export type DomainChangeAnnouncementAction = 'inspect' | 'enqueue'

export interface DomainChangeAnnouncementResult {
  eligibleUsers: number
  eligibleSubscriptions: number
  alreadyQueued: number
  inserted: number
}

export interface DomainChangeAnnouncementManager {
  run(action: DomainChangeAnnouncementAction): Promise<DomainChangeAnnouncementResult>
}

interface AnnouncementResultRow extends QueryResultRow {
  eligible_users: number | string
  eligible_subscriptions: number | string
  already_queued: number | string
  inserted: number | string
}

function readCount(value: number | string | undefined): number {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Invalid domain-change announcement aggregate')
  }
  return count
}

export class DatabaseDomainChangeAnnouncementManager
implements DomainChangeAnnouncementManager {
  constructor(private readonly pool: DatabasePool) {}

  async run(
    action: DomainChangeAnnouncementAction,
  ): Promise<DomainChangeAnnouncementResult> {
    const connection = await this.pool.connect()
    try {
      const rows = await connection.query<AnnouncementResultRow>(
        `select eligible_users, eligible_subscriptions, already_queued, inserted
         from app_private.enqueue_domain_change_announcement($1)`,
        [action === 'enqueue'],
      )
      const result = rows[0]
      if (result === undefined) {
        throw new Error('Domain-change announcement returned no aggregate')
      }
      return {
        eligibleUsers: readCount(result.eligible_users),
        eligibleSubscriptions: readCount(result.eligible_subscriptions),
        alreadyQueued: readCount(result.already_queued),
        inserted: readCount(result.inserted),
      }
    } finally {
      connection.release()
    }
  }
}
