import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'

interface InvitationCommandRow extends QueryResultRow {
  invitation_id: string
  invitation_code: string
  expires_at: Date
}

interface ClaimedInvitationRow extends QueryResultRow {
  client_id: string
}

export type PilotConnectionCommandFailure =
  | 'conflict'
  | 'forbidden'
  | 'invalid'
  | 'not_found'

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
