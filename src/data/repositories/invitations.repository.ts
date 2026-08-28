import { invitationQueries } from '../queries/invitations.queries'
import { repositoryError } from './error'
import type { ClientInvitation, TrainerMembership } from '../../shared/domain'

export interface DisconnectTrainerResult {
  clientId: string
  trainerId: string | null
  status: 'disconnected' | 'already_disconnected'
}

function disconnectTrainerResult(value: unknown): DisconnectTrainerResult {
  if (!value || typeof value !== 'object') throw new Error('Invalid disconnect trainer result')
  const row = value as Record<string, unknown>
  if (typeof row.clientId !== 'string'
    || (row.trainerId != null && typeof row.trainerId !== 'string')
    || (row.status !== 'disconnected' && row.status !== 'already_disconnected')) {
    throw new Error('Invalid disconnect trainer result')
  }
  return { clientId: row.clientId, trainerId: typeof row.trainerId === 'string' ? row.trainerId : null, status: row.status }
}

export const invitationsRepository = {
  async create(clientId: string, targetRole: 'client' | 'trainer'): Promise<string> {
    const result = await invitationQueries.create(clientId, targetRole)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async claim(code: string): Promise<string> {
    const result = await invitationQueries.claim(code.trim().toUpperCase())
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async reconnect(code: string): Promise<string> {
    const result = await invitationQueries.reconnect(code.trim().toUpperCase())
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async list(clientId: string): Promise<ClientInvitation[]> {
    const result = await invitationQueries.list(clientId)
    if (result.error) throw repositoryError(result.error)
    return result.data.map((row) => {
      if (row.target_role !== 'client' && row.target_role !== 'trainer') {
        throw new Error(`Unsupported invitation role: ${row.target_role}`)
      }
      return {
        id: row.id, clientId: row.client_id, targetRole: row.target_role,
        expiresAt: row.expires_at, createdAt: row.created_at,
      }
    })
  },
  async listTrainers(clientId: string): Promise<TrainerMembership[]> {
    const result = await invitationQueries.listTrainers(clientId)
    if (result.error) throw repositoryError(result.error)
    return result.data.map((row) => ({
      trainerId: row.trainer_id, firstName: row.first_name, lastName: row.last_name,
      joinedAt: row.joined_at, isRoot: row.is_root,
    }))
  },
  async revoke(invitationId: string): Promise<void> {
    const result = await invitationQueries.revoke(invitationId)
    if (result.error) throw repositoryError(result.error)
  },
  async disconnectTrainer(clientId: string): Promise<DisconnectTrainerResult> {
    const result = await invitationQueries.disconnectTrainer(clientId)
    if (result.error) throw repositoryError(result.error)
    return disconnectTrainerResult(result.data)
  },
  async removeTrainer(clientId: string, trainerId: string): Promise<void> {
    const result = await invitationQueries.removeTrainer(clientId, trainerId)
    if (result.error) throw repositoryError(result.error)
  },
  async leave(clientId: string): Promise<void> {
    const result = await invitationQueries.leave(clientId)
    if (result.error) throw repositoryError(result.error)
  },
}
