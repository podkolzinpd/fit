import type { QueryResultRow } from 'pg'

import { createPilotSessionToken, hashPilotSessionToken } from './auth/pilot-session-token.js'
import type { DatabasePool } from './db/types.js'
import { readOwnProfile, type ProfileResponse } from './profile.js'
import {
  YandexAppSessionInvalidError,
  withIssuedYandexAppSessionTransaction,
  withYandexAppSessionTransaction,
} from './db/yandex-app-transaction.js'

const APP_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1_000

interface RevokedRow extends QueryResultRow {
  revoked: boolean
}

export interface YandexAppSessionResponse extends ProfileResponse {
  accessMode: 'read_write'
  session: {
    token: string
    expiresAt: string
  }
}

export interface YandexAppSessionIssuer {
  issue(subjectHash: string): Promise<YandexAppSessionResponse | undefined>
}

export interface YandexAppSessionRevoker {
  revoke(sessionToken: string): Promise<boolean>
}

export class DatabaseYandexAppSessionIssuer implements YandexAppSessionIssuer {
  constructor(
    private readonly pool: DatabasePool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  issue(subjectHash: string): Promise<YandexAppSessionResponse | undefined> {
    const sessionToken = createPilotSessionToken()
    const expiresAt = new Date(this.now().getTime() + APP_SESSION_TTL_MS)

    return withIssuedYandexAppSessionTransaction(
      this.pool,
      subjectHash,
      sessionToken.sha256,
      expiresAt,
      async (client) => {
        const profile = await readOwnProfile(client, 'read_write')
        return profile === undefined
          ? undefined
          : {
              ...profile,
              accessMode: 'read_write',
              session: {
                token: sessionToken.raw,
                expiresAt: expiresAt.toISOString(),
              },
            }
      },
    )
  }
}

export class DatabaseYandexAppSessionRevoker implements YandexAppSessionRevoker {
  constructor(private readonly pool: DatabasePool) {}

  revoke(sessionToken: string): Promise<boolean> {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new YandexAppSessionInvalidError()

    return withYandexAppSessionTransaction(this.pool, tokenHash, async (client) => {
      const rows = await client.query<RevokedRow>(
        'select app_private.revoke_yandex_app_session($1) as revoked',
        [tokenHash],
      )
      return rows[0]?.revoked === true
    })
  }
}
