import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import {
  claimClientInvitation,
  createClientInvitation,
  leaveClientSpace,
  removeClientTrainer,
  revokeClientInvitation,
  type CreatedPilotInvitation,
} from './connection-commands.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'
import type { DatabasePool } from './db/types.js'

export interface PilotConnectionsWriter {
  claimInvitation(sessionToken: string, code: string): Promise<string>
  createInvitation(
    sessionToken: string,
    clientId: string,
    targetRole: 'client' | 'trainer',
  ): Promise<CreatedPilotInvitation>
  leaveClient(sessionToken: string, clientId: string): Promise<void>
  removeTrainer(
    sessionToken: string,
    clientId: string,
    trainerId: string,
  ): Promise<void>
  revokeInvitation(sessionToken: string, invitationId: string): Promise<void>
}

export class DatabasePilotConnectionsWriter implements PilotConnectionsWriter {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(
    sessionToken: string,
    work: Parameters<typeof withYandexPilotSessionTransaction<Result>>[2],
  ): Promise<Result> {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new PilotSessionInvalidError()
    return withYandexPilotSessionTransaction(this.pool, tokenHash, work)
  }

  claimInvitation(sessionToken: string, code: string): Promise<string> {
    return this.withSession(sessionToken, (client) =>
      claimClientInvitation(client, code))
  }

  createInvitation(
    sessionToken: string,
    clientId: string,
    targetRole: 'client' | 'trainer',
  ): Promise<CreatedPilotInvitation> {
    return this.withSession(sessionToken, (client) =>
      createClientInvitation(client, clientId, targetRole))
  }

  leaveClient(sessionToken: string, clientId: string): Promise<void> {
    return this.withSession(sessionToken, (client) =>
      leaveClientSpace(client, clientId))
  }

  removeTrainer(
    sessionToken: string,
    clientId: string,
    trainerId: string,
  ): Promise<void> {
    return this.withSession(sessionToken, (client) =>
      removeClientTrainer(client, clientId, trainerId))
  }

  revokeInvitation(
    sessionToken: string,
    invitationId: string,
  ): Promise<void> {
    return this.withSession(sessionToken, (client) =>
      revokeClientInvitation(client, invitationId))
  }
}
