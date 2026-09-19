import type { QueryResultRow } from 'pg'

import {
  fingerprintStandaloneClient,
  fingerprintTenant,
} from '../tenant-migration/bundle.js'
import type { DatabaseConnection, DatabasePool } from './types.js'

export type YandexIdentityUnlinkTarget =
  | { profileId: string }
  | { tenantFingerprint: string }

export interface YandexIdentityUnlinkResult {
  identityDeleted: boolean
  sessionsRevoked: number
}

export interface YandexIdentityUnlinkManager {
  unlink(target: YandexIdentityUnlinkTarget): Promise<YandexIdentityUnlinkResult>
}

interface CountRow extends QueryResultRow {
  count: string | number
}

interface ProfileCandidateRow extends QueryResultRow {
  account_role: 'trainer' | 'client'
  id: string
}

function readCount(row: CountRow | undefined): number {
  const value = row?.count
  const count = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Invalid unlink count')
  }
  return count
}

export class DatabaseYandexIdentityUnlinkManager
implements YandexIdentityUnlinkManager {
  constructor(private readonly pool: DatabasePool) {}

  async unlink(
    target: YandexIdentityUnlinkTarget,
  ): Promise<YandexIdentityUnlinkResult> {
    const connection = await this.pool.connect()

    try {
      await connection.query('begin')
      const profileId = 'profileId' in target
        ? target.profileId
        : await this.resolveProfileId(connection, target.tenantFingerprint)
      await connection.query(
        "select pg_advisory_xact_lock(hashtextextended('yandex_profile:' || $1::text, 0))",
        [profileId],
      )
      const identityRows = await connection.query<CountRow>(
        `with deleted as (
           delete from app_private.auth_identities
            where provider = 'yandex'
              and profile_id = $1
            returning 1
         )
         select count(*) as count from deleted`,
        [profileId],
      )
      const sessionRows = await connection.query<CountRow>(
        `with revoked as (
           update app_private.yandex_app_sessions
              set revoked_at = now()
            where profile_id = $1
              and revoked_at is null
            returning 1
         )
         select count(*) as count from revoked`,
        [profileId],
      )
      await connection.query('commit')

      return {
        identityDeleted: readCount(identityRows[0]) === 1,
        sessionsRevoked: readCount(sessionRows[0]),
      }
    } catch (error) {
      await connection.query('rollback').catch((rollbackError: unknown) => {
        throw new AggregateError(
          [error, rollbackError],
          'Yandex identity unlink and rollback both failed',
          { cause: rollbackError },
        )
      })
      throw error
    } finally {
      connection.release()
    }
  }

  private async resolveProfileId(
    connection: DatabaseConnection,
    tenantFingerprint: string,
  ): Promise<string> {
    const candidates = await connection.query<ProfileCandidateRow>(
      `
        select profile.id::text, profile.account_role
        from public.profiles profile
        where profile.account_role in ('trainer', 'client')
      `,
    )
    const matches = candidates.filter((candidate) => (
      candidate.account_role === 'trainer'
        ? fingerprintTenant(candidate.id)
        : fingerprintStandaloneClient(candidate.id)
    ) === tenantFingerprint)
    const match = matches[0]
    if (match === undefined || matches.length !== 1) {
      throw new Error('Yandex identity unlink target was not found')
    }
    return match.id
  }
}
