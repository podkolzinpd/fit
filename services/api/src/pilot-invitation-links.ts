import type { QueryResultRow } from 'pg'

import {
  claimClientInvitationLink,
  createClientInvitationShare,
  createNewClientInvitationShare,
  type CreatedPilotInvitationShare,
} from './connection-commands.js'
import type { DatabasePool } from './db/types.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'

interface InvitationPreviewRow extends QueryResultRow {
  target_role: 'client' | 'trainer'
  inviter_name: string
  expires_at: Date
  invitation_status: 'active' | 'claimed' | 'revoked' | 'expired'
}

export interface PilotInvitationPreview {
  targetRole: 'client' | 'trainer'
  inviterName: string
  expiresAt: string
  status: 'active' | 'claimed' | 'revoked' | 'expired'
}

export interface PilotInvitationLinks {
  preview(token: string): Promise<PilotInvitationPreview | null>
  create(
    session: YandexActorSessionInput,
    clientId: string,
    targetRole: 'client' | 'trainer',
  ): Promise<CreatedPilotInvitationShare>
  createForNewClient(
    session: YandexActorSessionInput,
    fullName: string,
    operationId: string,
  ): Promise<{ clientId: string; share: CreatedPilotInvitationShare }>
  claim(session: YandexActorSessionInput, token: string): Promise<string>
}

export class DatabasePilotInvitationLinks implements PilotInvitationLinks {
  constructor(private readonly pool: DatabasePool) {}

  create(
    session: YandexActorSessionInput,
    clientId: string,
    targetRole: 'client' | 'trainer',
  ): Promise<CreatedPilotInvitationShare> {
    return withYandexActorSession(this.pool, session, (client) =>
      createClientInvitationShare(client, clientId, targetRole))
  }

  createForNewClient(
    session: YandexActorSessionInput,
    fullName: string,
    operationId: string,
  ): Promise<{ clientId: string; share: CreatedPilotInvitationShare }> {
    return withYandexActorSession(this.pool, session, (client) =>
      createNewClientInvitationShare(client, fullName, operationId))
  }

  claim(session: YandexActorSessionInput, token: string): Promise<string> {
    return withYandexActorSession(this.pool, session, (client) =>
      claimClientInvitationLink(client, token))
  }

  async preview(token: string): Promise<PilotInvitationPreview | null> {
    const connection = await this.pool.connect()
    try {
      const rows = await connection.query<InvitationPreviewRow>(
        `
          select target_role, inviter_name, expires_at, invitation_status
          from public.get_client_invitation_preview($1)
        `,
        [token],
      )
      const preview = rows[0]
      return preview === undefined ? null : {
        targetRole: preview.target_role,
        inviterName: preview.inviter_name,
        expiresAt: preview.expires_at.toISOString(),
        status: preview.invitation_status,
      }
    } finally {
      connection.release()
    }
  }
}
