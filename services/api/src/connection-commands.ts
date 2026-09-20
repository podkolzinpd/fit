import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'

interface InvitationCommandRow extends QueryResultRow {
  invitation_id: string
  invitation_code: string
  expires_at: Date
}

interface InvitationShareCommandRow extends InvitationCommandRow {
  invitation_token: string
}

interface NewClientInvitationShareCommandRow extends InvitationShareCommandRow {
  client_id: string
}

interface ClaimedInvitationRow extends QueryResultRow {
  client_id: string
}

export type PilotConnectionCommandFailure =
  | 'conflict'
  | 'client_merge_conflict'
  | 'forbidden'
  | 'invalid'
  | 'not_found'
  | 'trainer_disconnect_required'
  | 'trainer_switch_required'

export class PilotConnectionCommandError extends Error {
  constructor(readonly failure: PilotConnectionCommandFailure) {
    super(`Pilot connection command failed: ${failure}`)
    this.name = 'PilotConnectionCommandError'
  }
}

export interface CreatedPilotInvitation {
  id: string
  clientId: string
  targetRole: 'client' | 'trainer'
  code: string
  expiresAt: string
}

export interface CreatedPilotInvitationShare extends CreatedPilotInvitation {
  token: string
}

function commandError(error: unknown): PilotConnectionCommandError | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return undefined
  }
  const message = error.message
  if (typeof message !== 'string') return undefined
  if (
    message === 'invitation_not_allowed'
    || message === 'invitation_role_mismatch'
    || message === 'membership_not_allowed'
  ) {
    return new PilotConnectionCommandError('forbidden')
  }
  if (
    message === 'invitation_invalid'
    || message === 'invitation_not_found'
    || message === 'membership_not_found'
  ) {
    return new PilotConnectionCommandError('not_found')
  }
  if (message === 'trainer_disconnect_required') {
    return new PilotConnectionCommandError('trainer_disconnect_required')
  }
  if (message === 'trainer_switch_required') {
    return new PilotConnectionCommandError('trainer_switch_required')
  }
  if (message.startsWith('client_merge_') && message.endsWith('_conflict')) {
    return new PilotConnectionCommandError('client_merge_conflict')
  }
  if (message === 'client_already_linked') {
    return new PilotConnectionCommandError('conflict')
  }
  if (
    message === 'invalid_invitation_role'
    || message === 'root_trainer_cannot_be_removed'
    || message === 'root_trainer_cannot_leave'
  ) {
    return new PilotConnectionCommandError('invalid')
  }
  return undefined
}

async function runCommand<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work()
  } catch (error) {
    throw commandError(error) ?? error
  }
}

export function createClientInvitation(
  client: DatabaseClient,
  clientId: string,
  targetRole: 'client' | 'trainer',
): Promise<CreatedPilotInvitation> {
  return runCommand(async () => {
    const rows = await client.query<InvitationCommandRow>(
      `
        select invitation_id, invitation_code, expires_at
        from public.create_client_invitation($1, $2)
      `,
      [clientId, targetRole],
    )
    const invitation = rows[0]
    if (invitation === undefined) throw new Error('Invitation was not created')
    return {
      id: invitation.invitation_id,
      clientId,
      targetRole,
      code: invitation.invitation_code,
      expiresAt: invitation.expires_at.toISOString(),
    }
  })
}

export function createClientInvitationShare(
  client: DatabaseClient,
  clientId: string,
  targetRole: 'client' | 'trainer',
): Promise<CreatedPilotInvitationShare> {
  return runCommand(async () => {
    const rows = await client.query<InvitationShareCommandRow>(
      `
        select invitation_id, invitation_code, invitation_token, expires_at
        from public.create_client_invitation_share($1, $2)
      `,
      [clientId, targetRole],
    )
    const invitation = rows[0]
    if (invitation === undefined) throw new Error('Invitation share was not created')
    return {
      id: invitation.invitation_id,
      clientId,
      targetRole,
      code: invitation.invitation_code,
      token: invitation.invitation_token,
      expiresAt: invitation.expires_at.toISOString(),
    }
  })
}

export function createNewClientInvitationShare(
  client: DatabaseClient,
  fullName: string,
  operationId: string,
): Promise<{ clientId: string; share: CreatedPilotInvitationShare }> {
  return runCommand(async () => {
    const rows = await client.query<NewClientInvitationShareCommandRow>(
      `
        select client_id, invitation_id, invitation_code, invitation_token, expires_at
        from public.create_new_client_invitation_share($1, $2)
      `,
      [fullName, operationId],
    )
    const invitation = rows[0]
    if (invitation === undefined) throw new Error('New client invitation share was not created')
    return {
      clientId: invitation.client_id,
      share: {
        id: invitation.invitation_id,
        clientId: invitation.client_id,
        targetRole: 'client',
        code: invitation.invitation_code,
        token: invitation.invitation_token,
        expiresAt: invitation.expires_at.toISOString(),
      },
    }
  })
}

export function claimClientInvitation(
  client: DatabaseClient,
  code: string,
): Promise<string> {
  return runCommand(async () => {
    const rows = await client.query<ClaimedInvitationRow>(
      'select public.claim_client_invitation($1) as client_id',
      [code],
    )
    const clientId = rows[0]?.client_id
    if (clientId === undefined) throw new Error('Invitation was not claimed')
    return clientId
  })
}

export function claimClientInvitationLink(
  client: DatabaseClient,
  token: string,
): Promise<string> {
  return runCommand(async () => {
    const rows = await client.query<ClaimedInvitationRow>(
      'select public.claim_client_invitation_link($1) as client_id',
      [token],
    )
    const clientId = rows[0]?.client_id
    if (clientId === undefined) throw new Error('Invitation link was not claimed')
    return clientId
  })
}

export function revokeClientInvitation(
  client: DatabaseClient,
  invitationId: string,
): Promise<void> {
  return runCommand(async () => {
    await client.query('select public.revoke_client_invitation($1)', [invitationId])
  })
}

export function removeClientTrainer(
  client: DatabaseClient,
  clientId: string,
  trainerId: string,
): Promise<void> {
  return runCommand(async () => {
    await client.query('select public.remove_client_trainer($1, $2)', [clientId, trainerId])
  })
}

export function leaveClientSpace(
  client: DatabaseClient,
  clientId: string,
): Promise<void> {
  return runCommand(async () => {
    await client.query('select public.leave_client_space($1)', [clientId])
  })
}
