import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import type { InvitationShare } from '../../shared/domain'
import { invitationShareText, connectionShareUrl } from '../../shared/invitation-share'
import { InvitationShareDialog } from '../../shared/InvitationShareDialog'
import { trackGoal } from '../../shared/yandex-metrika'

function inviterName(firstName: string | null | undefined): string {
  return firstName?.trim() || 'Пользователь Fit'
}

export function InvitationShareButton({
  clientId,
  targetRole,
  label,
  className,
  cardName,
}: {
  clientId: string
  targetRole: 'client' | 'trainer'
  label: string
  className?: string
  cardName?: string
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { actor } = useAuth()
  const backend = useDataBackend()
  const queryClient = useQueryClient()
  const invitation = useMutation({
    mutationFn: () => backend.invitations.createShare(clientId, targetRole),
    onSuccess: async () => {
      trackGoal('invitation_created')
      await queryClient.invalidateQueries({ queryKey: ['client-invitations', clientId] })
    },
    onError: async () => {
      trackGoal('invitation_create_error')
      if (targetRole === 'client') await queryClient.invalidateQueries({ queryKey: ['client', clientId] })
    },
  })

  async function revoke(share: InvitationShare): Promise<void> {
    await backend.invitations.revoke(share.id)
    await queryClient.invalidateQueries({ queryKey: ['client-invitations', clientId] })
  }

  return <>
    <button ref={triggerRef} type="button" className={className} disabled={invitation.isPending} aria-busy={invitation.isPending} onClick={() => invitation.mutate()}>{invitation.isPending ? 'Создаём ссылку…' : label}</button>
    {invitation.error && <p className="error invitation-launch-error" role="alert">{invitation.error.message}</p>}
    {invitation.data && <InvitationShareDialog
      returnFocusRef={triggerRef}
      share={invitation.data}
      source={backend.source}
      message={invitationShareText(inviterName(actor?.firstName), targetRole)}
      description={cardName ? `Отправьте приглашение спортсмену «${cardName}». После принятия он увидит ранее записанные тренировки.` : undefined}
      onClose={() => invitation.reset()}
      onRevoke={() => revoke(invitation.data)}
    />}
  </>
}

export function InviteAthleteButton({ className, label = 'Пригласить' }: { className?: string; label?: string }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { actor } = useAuth()
  const { connectionDirectory: repository } = useDataBackend()
  const invitation = useMutation({ mutationFn: () => {
    if (!repository) throw new Error('Приглашения недоступны. Повторите вход.')
    return repository.createInvitation()
  } })
  return <>
    <button ref={triggerRef} type="button" className={className} disabled={invitation.isPending} onClick={() => invitation.mutate()}>{invitation.isPending ? 'Готовим приглашение…' : label}</button>
    {invitation.error && <p className="error" role="alert">{invitation.error.message}</p>}
    {invitation.data && <InvitationShareDialog
      returnFocusRef={triggerRef}
      share={{ code: invitation.data.code, expiresAt: invitation.data.expiresAt, targetRole: 'client' }}
      source="yandex" invitationUrl={connectionShareUrl(invitation.data.code)}
      message={`${inviterName(actor?.firstName)} приглашает вас тренироваться вместе в Fit.`}
      description="Отправьте ссылку спортсмену. Ему останется войти или зарегистрироваться и принять приглашение."
      onClose={() => invitation.reset()}
      onRevoke={async () => { await repository!.revokeInvitation(invitation.data!.code) }}
    />}
  </>
}
