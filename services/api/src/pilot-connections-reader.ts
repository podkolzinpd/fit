import {
  readAccessibleConnections,
  type PilotConnectionsResponse,
} from './connections.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'
import type { DatabasePool } from './db/types.js'

export interface PilotConnectionsReader {
  readConnections(session: YandexActorSessionInput): Promise<PilotConnectionsResponse>
}

export class DatabasePilotConnectionsReader implements PilotConnectionsReader {
  constructor(private readonly pool: DatabasePool) {}

  readConnections(session: YandexActorSessionInput): Promise<PilotConnectionsResponse> {
    return withYandexActorSession(
      this.pool,
      session,
      readAccessibleConnections,
    )
  }
}
