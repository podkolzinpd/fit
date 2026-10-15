import { z } from 'zod'

import { getYandexMainRoutingConfig, isYandexMainRoutingEnabled } from '../../app/feature-flags'
import type { InvitationLinkPreview, InvitationLinkSource } from '../../shared/domain'

const previewSchema = z.object({
  invitation: z.object({
    targetRole: z.enum(['client', 'trainer']),
    inviterName: z.string(),
    expiresAt: z.iso.datetime(),
    status: z.enum(['active', 'claimed', 'revoked', 'expired']),
  }),
})

async function previewYandexInvitation(token: string): Promise<InvitationLinkPreview | null> {
  const config = getYandexMainRoutingConfig()
  if (config === null) throw new Error('Приглашение временно недоступно.')
  const response = await fetch(`${config.apiBaseUrl}/v1/invitation-links/preview`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Не удалось проверить приглашение.')
  return previewSchema.parse(await response.json()).invitation
}

async function previewLocalInvitation(token: string): Promise<InvitationLinkPreview | null> {
  if (import.meta.env.MODE !== 'development' && import.meta.env.MODE !== 'test') {
    throw new Error('Устаревший источник данных недоступен в этой сборке.')
  }
  const { invitationsRepository } = await import('./invitations.repository')
  return invitationsRepository.previewLink(token)
}

export const publicInvitationLinksRepository = {
  preview(source: InvitationLinkSource, token: string): Promise<InvitationLinkPreview | null> {
    return source === 'yandex' || isYandexMainRoutingEnabled()
      ? previewYandexInvitation(token)
      : previewLocalInvitation(token)
  },
}
