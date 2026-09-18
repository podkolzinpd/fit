import { z } from 'zod'
import { invitationQueries } from '../queries/invitations.queries'
import { yandexInvitationLinkQueries } from '../queries/yandex-invitation-links.queries'
import { RepositoryError, repositoryError } from './error'
import type { ClientInvitation, TrainerMembership } from '../../shared/domain'

const invitationLinkPreviewSchema = z.object({
  targetRole: z.enum(['client', 'trainer']),
  inviterName: z.string().min(1),
  expiresAt: z.iso.datetime(),
  status: z.enum(['active', 'claimed', 'revoked', 'expired']),
})

const invitationLinkResponseSchema = z.object({ invitation: invitationLinkPreviewSchema })
const claimedInvitationLinkSchema = z.object({ clientId: z.uuid() })

export type InvitationLinkPreview = z.infer<typeof invitationLinkPreviewSchema>

export interface InvitationLinksRepository {
  preview(token: string): Promise<InvitationLinkPreview | null>
  claim(token: string): Promise<string>
}

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

export const invitationLinksRepository: InvitationLinksRepository = {
  async preview(token) {
    const result = await invitationQueries.previewLink(token)
    if (result.error) throw repositoryError(result.error)
    const row = result.data[0]
    if (row === undefined) return null
    return invitationLinkPreviewSchema.parse({
      targetRole: row.target_role,
      inviterName: row.inviter_name,
      expiresAt: row.expires_at,
      status: row.invitation_status,
    })
  },
  async claim(token) {
    const result = await invitationQueries.claimLink(token)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
}

function yandexInvitationLinkError(status: number): RepositoryError {
  if (status === 401) return new RepositoryError('authentication_required', 'Войдите в аккаунт и повторите подключение.')
  if (status === 403) return new RepositoryError('invitation_role_mismatch', 'Это приглашение предназначено для другого типа аккаунта.')
  if (status === 404) return new RepositoryError('invitation_invalid', 'Ссылка приглашения недействительна или больше не доступна.')
  if (status === 409) return new RepositoryError('invitation_conflict', 'Связь уже создана или требует отключить текущего тренера.')
  if (status >= 500) return new RepositoryError('service_unavailable', 'Yandex Cloud временно недоступен. Попробуйте позднее.')
  return new RepositoryError('invalid_request', 'Сервер не принял приглашение. Обновите страницу и повторите.')
}

async function yandexInvitationLinkResponse(work: () => Promise<Response>): Promise<Response> {
  let response: Response
  try {
    response = await work()
  } catch (error) {
    throw new RepositoryError(
      'network_unavailable',
      'Не удалось подключиться к серверу. Проверьте интернет и повторите попытку.',
      { cause: error },
    )
  }
  if (!response.ok) throw yandexInvitationLinkError(response.status)
  return response
}

export function createYandexInvitationLinksRepository(
  apiBaseUrl: string,
  sessionToken: string | null,
): InvitationLinksRepository {
  return {
    async preview(token) {
      let response: Response
      try {
        response = await yandexInvitationLinkQueries.preview(apiBaseUrl, token)
      } catch (error) {
        throw new RepositoryError(
          'network_unavailable',
          'Не удалось подключиться к серверу. Проверьте интернет и повторите попытку.',
          { cause: error },
        )
      }
      if (response.status === 404) return null
      if (!response.ok) throw yandexInvitationLinkError(response.status)
      return invitationLinkResponseSchema.parse(await response.json()).invitation
    },
    async claim(token) {
      if (sessionToken === null) throw yandexInvitationLinkError(401)
      const response = await yandexInvitationLinkResponse(
        () => yandexInvitationLinkQueries.claim(apiBaseUrl, sessionToken, token),
      )
      return claimedInvitationLinkSchema.parse(await response.json()).clientId
    },
  }
}
