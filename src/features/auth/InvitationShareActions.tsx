import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'

import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import type { InvitationShare } from '../../shared/domain'
import { CloseIcon } from '../../shared/icons'
import { invitationShareText } from '../../shared/invitation-share'
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
}: {
  clientId: string
  targetRole: 'client' | 'trainer'
  label: string
  className?: string
}) {
  const { actor } = useAuth()
  const backend = useDataBackend()
  const queryClient = useQueryClient()
  const invitation = useMutation({
    mutationFn: () => backend.invitations.createShare(clientId, targetRole),
    onSuccess: async () => {
      trackGoal('invitation_created')
      await queryClient.invalidateQueries({ queryKey: ['client-invitations', clientId] })
    },
    onError: () => trackGoal('invitation_create_error'),
  })

  async function revoke(share: InvitationShare): Promise<void> {
    await backend.invitations.revoke(share.id)
    await queryClient.invalidateQueries({ queryKey: ['client-invitations', clientId] })
  }

  return <>
    <button type="button" className={className} disabled={invitation.isPending} aria-busy={invitation.isPending} onClick={() => invitation.mutate()}>{invitation.isPending ? 'Создаём ссылку…' : label}</button>
    {invitation.error && <p className="error invitation-launch-error" role="alert">{invitation.error.message}</p>}
    {invitation.data && <InvitationShareDialog
      share={invitation.data}
      source={backend.source}
      message={invitationShareText(inviterName(actor?.firstName), targetRole)}
      onClose={() => invitation.reset()}
      onRevoke={() => revoke(invitation.data)}
    />}
  </>
}

export function InviteAthleteButton({ className, label = 'Пригласить спортсмена' }: { className?: string; label?: string }) {
  const { actor } = useAuth()
  const backend = useDataBackend()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [clientId, setClientId] = useState<string | null>(null)
  const invitation = useMutation({
    mutationFn: async () => {
      const id = clientId ?? await backend.clients.createQuick(fullName.trim())
      if (clientId === null) setClientId(id)
      const share = await backend.invitations.createShare(id, 'client')
      return { clientId: id, share }
    },
    onSuccess: async () => {
      trackGoal('invitation_created')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['clients'] }),
        queryClient.invalidateQueries({ queryKey: ['client-invitations'] }),
      ])
    },
    onError: () => trackGoal('invitation_create_error'),
  })

  function close(): void {
    setOpen(false)
    setFullName('')
    setClientId(null)
    invitation.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (fullName.trim().length < 2) return
    invitation.mutate()
  }

  async function revoke(): Promise<void> {
    if (!invitation.data) return
    await backend.invitations.revoke(invitation.data.share.id)
    await queryClient.invalidateQueries({ queryKey: ['client-invitations', invitation.data.clientId] })
  }

  const host = document.querySelector('.phone-frame') ?? document.body
  return <>
    <button type="button" className={className} aria-label="Пригласить спортсмена" onClick={() => setOpen(true)}>{label}</button>
    {open && invitation.data === undefined && createPortal(<div className="modal-overlay invitation-name-overlay" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) close()
    }}>
      <section className="invitation-name-dialog" role="dialog" aria-modal="true" aria-labelledby="invitation-name-title">
        <header><div><p className="eyebrow">НОВЫЙ СПОРТСМЕН</p><h2 id="invitation-name-title">Кого пригласить?</h2></div><button type="button" className="icon-button" aria-label="Закрыть" onClick={close}><CloseIcon /></button></header>
        <p className="muted">Имя появится в списке клиентов. Остальные данные спортсмен заполнит позже.</p>
        <form className="stack" onSubmit={submit}>
          <label>Имя спортсмена<input autoFocus value={fullName} minLength={2} maxLength={120} required onChange={(event) => setFullName(event.target.value)} /></label>
          {invitation.error && <p className="error" role="alert">{invitation.error.message}</p>}
          <button className="primary" disabled={invitation.isPending} aria-busy={invitation.isPending}>{invitation.isPending ? 'Создаём ссылку…' : 'Создать приглашение'}</button>
        </form>
      </section>
    </div>, host)}
    {invitation.data && <InvitationShareDialog
      share={invitation.data.share}
      source={backend.source}
      message={invitationShareText(inviterName(actor?.firstName), 'client')}
      onClose={close}
      onRevoke={revoke}
    />}
  </>
}
