import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import { readAccessibleClients, type PilotClientsResponse } from './clients.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'
import type { DatabasePool } from './db/types.js'

export interface PilotClientsReader {
  readClients(sessionToken: string): Promise<PilotClientsResponse>
}

export class DatabasePilotClientsReader implements PilotClientsReader {
  constructor(private readonly pool: DatabasePool) {}

  readClients(sessionToken: string): Promise<PilotClientsResponse> {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new PilotSessionInvalidError()

    return withYandexPilotSessionTransaction(
      this.pool,
      tokenHash,
      readAccessibleClients,
    )
  }
}
