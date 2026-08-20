import { createPilotSessionToken } from './auth/pilot-session-token.js'
import { withIssuedYandexPilotSessionTransaction } from './db/yandex-pilot-transaction.js'
import type { DatabasePool } from './db/types.js'
import { readOwnProfile, type ProfileResponse } from './profile.js'

const PILOT_SESSION_TTL_MS = 15 * 60 * 1_000

export interface PilotSessionResponse extends ProfileResponse {
  session: {
    token: string
    expiresAt: string
  }
}

export interface PilotSessionIssuer {
  issue(subjectHash: string): Promise<PilotSessionResponse | undefined>
}

export class DatabasePilotSessionIssuer implements PilotSessionIssuer {
  constructor(
    private readonly pool: DatabasePool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  issue(subjectHash: string): Promise<PilotSessionResponse | undefined> {
    const sessionToken = createPilotSessionToken()
    const expiresAt = new Date(this.now().getTime() + PILOT_SESSION_TTL_MS)

    return withIssuedYandexPilotSessionTransaction(
      this.pool,
      subjectHash,
      sessionToken.sha256,
      expiresAt,
      async (client) => {
        const profile = await readOwnProfile(client)
        return profile === undefined
          ? undefined
          : {
              ...profile,
              session: {
                token: sessionToken.raw,
                expiresAt: expiresAt.toISOString(),
              },
            }
      },
    )
  }
}
