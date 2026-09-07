import {
  claimClientInvitation,
  createClientInvitation,
  leaveClientSpace,
  removeClientTrainer,
  revokeClientInvitation,
  type CreatedPilotInvitation,
} from './connection-commands.js'
import type { DatabasePool } from './db/types.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'

export interface PilotConnectionsWriter {
  claimInvitation(session: YandexActorSessionInput, code: string): Promise<string>
  createInvitation(
    session: YandexActorSessionInput,
    clientId: string,
    targetRole: 'client' | 'trainer',
  ): Promise<CreatedPilotInvitation>
  leaveClient(session: YandexActorSessionInput, clientId: string): Promise<void>
  removeTrainer(
    session: YandexActorSessionInput,
    clientId: string,
    trainerId: string,
  ): Promise<void>
  revokeInvitation(session: YandexActorSessionInput, invitationId: string): Promise<void>
}

export class DatabasePilotConnectionsWriter implements PilotConnectionsWriter {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(
    session: YandexActorSessionInput,
    work: Parameters<typeof withYandexActorSession<Result>>[2],
  ): Promise<Result> {
    return withYandexActorSession(this.pool, session, work)
  }

  claimInvitation(session: YandexActorSessionInput, code: string): Promise<string> {
    return this.withSession(session, (client) =>
      claimClientInvitation(client, code))
  }

  createInvitation(
    session: YandexActorSessionInput,
    clientId: string,
    targetRole: 'client' | 'trainer',
  ): Promise<CreatedPilotInvitation> {
    return this.withSession(session, (client) =>
      createClientInvitation(client, clientId, targetRole))
  }

  leaveClient(session: YandexActorSessionInput, clientId: string): Promise<void> {
    return this.withSession(session, (client) =>
      leaveClientSpace(client, clientId))
  }

  removeTrainer(
    session: YandexActorSessionInput,
    clientId: string,
    trainerId: string,
  ): Promise<void> {
    return this.withSession(session, (client) =>
      removeClientTrainer(client, clientId, trainerId))
  }

  revokeInvitation(
    session: YandexActorSessionInput,
    invitationId: string,
  ): Promise<void> {
    return this.withSession(session, (client) =>
      revokeClientInvitation(client, invitationId))
  }
}
