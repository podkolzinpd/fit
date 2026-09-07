import { readAccessibleClients, type PilotClientsResponse } from './clients.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'
import type { DatabasePool } from './db/types.js'

export interface PilotClientsReader {
  readClients(session: YandexActorSessionInput, archived?: boolean): Promise<PilotClientsResponse>
}

export class DatabasePilotClientsReader implements PilotClientsReader {
  constructor(private readonly pool: DatabasePool) {}

  readClients(session: YandexActorSessionInput, archived = false): Promise<PilotClientsResponse> {
    return withYandexActorSession(
      this.pool,
      session,
      (client) => readAccessibleClients(client, archived),
    )
  }
}
