import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { useYandexAppSession } from '../../app/yandex-app-session-context'
import { authRepository } from '../../data/repositories/auth.repository'
import { RepositoryError } from '../../data/repositories/error'
import { invitationsRepository } from '../../data/repositories/invitations.repository'
import { publicInvitationLinksRepository } from '../../data/repositories/public-invitation-links.repository'
import { StatePanel } from '../../shared/ui'
import {
  captureInvitationLink,
  clearPendingInvitationLink,
  type PendingInvitationLink,
} from './invitation-link-continuation'
import { AuthIdentityScreen } from './AuthPages'

function invitationTitle(inviterName: string, targetRole: 'client' | 'trainer'): string {
  return targetRole === 'trainer'
    ? `${inviterName} приглашает вас стать тренером`
    : `${inviterName} приглашает вас стать спортсменом`
}

function terminalCopy(status: 'claimed' | 'revoked' | 'expired'): { title: string; description: string } {
  if (status === 'claimed') return {
    title: 'Приглашение уже принято',
    description: 'Эта ссылка уже была использована.',
  }
  if (status === 'revoked') return {
    title: 'Приглашение отменено',
    description: 'Попросите отправителя создать новую ссылку.',
  }
  return {
    title: 'Срок приглашения истёк',
    description: 'Попросите отправителя создать новую ссылку.',
  }
}

export function InvitationPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { actor, loading: authLoading } = useAuth()
  const backend = useDataBackend()
  const yandexSession = useYandexAppSession()
  const [pending] = useState<PendingInvitationLink | null>(() =>
    captureInvitationLink(window.location.hash))
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
  }, [])

  const preview = useQuery({
    queryKey: ['invitation-link-preview', pending?.source, pending?.token.slice(0, 12)],
    queryFn: () => publicInvitationLinksRepository.preview(pending!.source, pending!.token),
    enabled: pending !== null,
    retry: false,
  })
  useEffect(() => {
    if (preview.data !== null && preview.data !== undefined && preview.data.status !== 'active') {
      clearPendingInvitationLink()
    }
  }, [preview.data])
  const claim = useMutation({
    mutationFn: async () => {
      if (pending === null) throw new Error('Ссылка приглашения не найдена.')
      if (pending.source === backend.source) {
        return backend.invitations.claimLink(pending.token)
      }
      if (pending.source === 'supabase') {
        return invitationsRepository.claimLink(pending.token)
      }
      throw new Error('Завершите вход через Yandex ID и откройте ссылку снова.')
    },
    onSuccess: async () => {
      clearPendingInvitationLink()
      await queryClient.invalidateQueries()
    },
  })

  const invitation = preview.data
  const roleMismatch = actor !== null && invitation !== null && invitation !== undefined
    && actor.role !== invitation.targetRole
  const requiresDisconnect = claim.error instanceof RepositoryError
    && claim.error.code === 'trainer_disconnect_required'
  const homePath = actor?.role === 'client' ? '/me' : '/clients'

  async function changeAccount(): Promise<void> {
    setSigningOut(true)
    await Promise.allSettled([authRepository.signOut(), yandexSession.signOut()])
    navigate('/auth', {
      replace: true,
      state: { from: '/invite', inviteRole: invitation?.targetRole },
    })
  }

  if (claim.isSuccess) {
    return <AuthIdentityScreen className="invitation-page">
      <header className="auth-entry-head">
        <div className="brand" aria-hidden="true">FIT</div>
        <p className="eyebrow">ГОТОВО</p>
        <h1>{actor?.role === 'client' ? 'Тренер подключён' : 'Спортсмен подключён'}</h1>
        <p className="muted">Теперь можно продолжить работу вместе.</p>
      </header>
      <button className="primary" type="button" onClick={() => navigate(
        actor?.role === 'client' ? '/me' : `/clients/${claim.data}`,
        { replace: true },
      )}>{actor?.role === 'client' ? 'Открыть кабинет' : 'Открыть карточку'}</button>
    </AuthIdentityScreen>
  }

  if (pending === null) {
    return <AuthIdentityScreen className="invitation-page">
      <header className="auth-entry-head"><div className="brand" aria-hidden="true">FIT</div></header>
      <StatePanel tone="error" title="Ссылка не работает" description="Проверьте ссылку или попросите новое приглашение." />
      <Link className="auth-back-link" to={actor ? homePath : '/auth'}>{actor ? 'Вернуться в Fit' : 'Перейти ко входу'}</Link>
    </AuthIdentityScreen>
  }

  if (preview.isPending || authLoading) {
    return <AuthIdentityScreen className="invitation-page">
      <header className="auth-entry-head"><div className="brand" aria-hidden="true">FIT</div></header>
      <StatePanel tone="info" title="Проверяем приглашение" description="Это займёт несколько секунд." />
    </AuthIdentityScreen>
  }

  if (preview.isError || invitation === null || invitation === undefined) {
    return <AuthIdentityScreen className="invitation-page">
      <header className="auth-entry-head"><div className="brand" aria-hidden="true">FIT</div></header>
      <StatePanel tone="error" title="Ссылка не работает" description="Проверьте ссылку или попросите новое приглашение." action={<button type="button" className="secondary" onClick={() => void preview.refetch()}>Повторить</button>} />
      <Link className="auth-back-link" to={actor ? homePath : '/auth'}>{actor ? 'Вернуться в Fit' : 'Перейти ко входу'}</Link>
    </AuthIdentityScreen>
  }

  if (invitation.status !== 'active') {
    const copy = terminalCopy(invitation.status)
    return <AuthIdentityScreen className="invitation-page">
      <header className="auth-entry-head"><div className="brand" aria-hidden="true">FIT</div></header>
      <StatePanel tone={invitation.status === 'claimed' ? 'info' : 'error'} title={copy.title} description={copy.description} />
      <Link className="auth-back-link" to={actor ? homePath : '/auth'}>{actor ? 'Вернуться в Fit' : 'Перейти ко входу'}</Link>
    </AuthIdentityScreen>
  }

  const expiresAt = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(new Date(invitation.expiresAt))

  return <AuthIdentityScreen className="invitation-page">
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">ПРИГЛАШЕНИЕ В FIT</p>
      <h1>{invitationTitle(invitation.inviterName, invitation.targetRole)}</h1>
      <p className="muted">После подключения вы увидите общие тренировки и сможете общаться в Fit.</p>
    </header>
    <section className="compact stack invitation-summary" aria-label="Приглашение">
      <div><span>Ваша роль</span><strong>{invitation.targetRole === 'trainer' ? 'Тренер' : 'Спортсмен'}</strong></div>
      <div><span>Действует до</span><strong>{expiresAt}</strong></div>
    </section>
    {actor === null ? <div className="stack invitation-actions">
      <button type="button" className="primary" onClick={() => navigate('/auth', {
        state: { from: '/invite', mode: 'login', inviteRole: invitation.targetRole },
      })}>Войти и подключиться</button>
      <button type="button" className="secondary" onClick={() => navigate('/auth', {
        state: { from: '/invite', mode: 'register', inviteRole: invitation.targetRole },
      })}>Создать аккаунт</button>
    </div> : roleMismatch ? <StatePanel
      tone="error"
      title={`Это приглашение предназначено ${invitation.targetRole === 'trainer' ? 'тренеру' : 'спортсмену'}`}
      description="Войдите под аккаунтом с нужной ролью."
      action={<button type="button" className="secondary" disabled={signingOut} onClick={() => void changeAccount()}>{signingOut ? 'Выходим…' : 'Войти под другим аккаунтом'}</button>}
    /> : <div className="stack invitation-actions">
      {requiresDisconnect ? <StatePanel tone="error" title="Сначала отключите текущего тренера" description="Аккаунт, тренировки и замеры сохранятся." action={<Link className="button secondary" to="/me/profile">Открыть профиль</Link>} />
        : claim.error && <p className="error" role="alert">{claim.error.message}</p>}
      <button type="button" className="primary" disabled={claim.isPending || requiresDisconnect} onClick={() => claim.mutate()}>{claim.isPending ? 'Подключаем…' : invitation.targetRole === 'trainer' ? 'Стать тренером' : 'Подключиться к тренеру'}</button>
    </div>}
  </AuthIdentityScreen>
}
