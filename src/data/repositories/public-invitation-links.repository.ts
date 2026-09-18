import { z } from 'zod'

import { getYandexMainRoutingConfig } from '../../app/feature-flags'
import type { InvitationLinkPreview, InvitationLinkSource } from '../../shared/domain'
import { invitationsRepository } from './invitations.repository'

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

export const publicInvitationLinksRepository = {
  preview(source: InvitationLinkSource, token: string): Promise<InvitationLinkPreview | null> {
    return source === 'yandex'
      ? previewYandexInvitation(token)
      : invitationsRepository.previewLink(token)
  },
}
