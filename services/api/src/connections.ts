import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'

interface MembershipRow extends QueryResultRow {
  client_id: string
  trainer_id: string
  first_name: string | null
  last_name: string | null
  joined_at: Date
  is_root: boolean
}

interface InvitationRow extends QueryResultRow {
  id: string
  client_id: string
  target_role: 'client' | 'trainer'
  expires_at: Date
  created_at: Date
}

export interface PilotTrainerMembership {
  clientId: string
  trainerId: string
  firstName: string | null
  lastName: string | null
  joinedAt: string
  isRoot: boolean
}

export interface PilotClientInvitation {
  id: string
  clientId: string
  targetRole: 'client' | 'trainer'
  expiresAt: string
  createdAt: string
}

export interface PilotConnectionsResponse {
  accessMode: 'read_only'
  memberships: PilotTrainerMembership[]
  invitations: PilotClientInvitation[]
}

export async function readAccessibleConnections(
  client: DatabaseClient,
): Promise<PilotConnectionsResponse> {
  const memberships = await client.query<MembershipRow>(`
    select client_id, trainer_id, first_name, last_name, joined_at, is_root
    from public.list_accessible_client_trainers()
  `)
  const invitations = await client.query<InvitationRow>(`
    select id, client_id, target_role, expires_at, created_at
    from public.client_invitations
    where created_by = auth.uid()
      and claimed_at is null
      and revoked_at is null
      and expires_at > now()
    order by created_at desc, id
  `)

  return {
    accessMode: 'read_only',
    memberships: memberships.map((row) => ({
      clientId: row.client_id,
      trainerId: row.trainer_id,
      firstName: row.first_name,
      lastName: row.last_name,
      joinedAt: row.joined_at.toISOString(),
      isRoot: row.is_root,
    })),
    invitations: invitations.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      targetRole: row.target_role,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    })),
  }
}
