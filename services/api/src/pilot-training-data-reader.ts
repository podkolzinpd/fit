import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'
import type { DatabasePool } from './db/types.js'
import {
  readAccessibleTrainingData,
  type PilotTrainingDataResponse,
} from './training-data.js'

export interface PilotTrainingDataReader {
  readTrainingData(sessionToken: string): Promise<PilotTrainingDataResponse>
}

export class DatabasePilotTrainingDataReader implements PilotTrainingDataReader {
  constructor(private readonly pool: DatabasePool) {}

  readTrainingData(sessionToken: string): Promise<PilotTrainingDataResponse> {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new PilotSessionInvalidError()

    return withYandexPilotSessionTransaction(
      this.pool,
      tokenHash,
      readAccessibleTrainingData,
    )
  }
}
