import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import {
  readAccessibleConnections,
  type PilotConnectionsResponse,
} from './connections.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'
import type { DatabasePool } from './db/types.js'

export interface PilotConnectionsReader {
  readConnections(sessionToken: string): Promise<PilotConnectionsResponse>
}

export class DatabasePilotConnectionsReader implements PilotConnectionsReader {
  constructor(private readonly pool: DatabasePool) {}

  readConnections(sessionToken: string): Promise<PilotConnectionsResponse> {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new PilotSessionInvalidError()

    return withYandexPilotSessionTransaction(
      this.pool,
      tokenHash,
      readAccessibleConnections,
    )
  }
}
