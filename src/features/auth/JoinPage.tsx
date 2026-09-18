import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { RepositoryError } from '../../data/repositories/error'
import { Field, Page, StatePanel } from '../../shared/ui'
import { AuthIdentityScreen } from './AuthPages'
import {
  invitationAuthPath,
  normalizeInvitationLinkToken,
  savePendingInvitation,
} from './invitation-auth'

function invitationExpiry(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value))
}

export function InvitationLinkPage() {
  const { invitationLinks } = useDataBackend()
  const { actor, loading: authLoading, signOut } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const token = normalizeInvitationLinkToken(searchParams.get('token'))
  const returnTo = token === null ? null : invitationAuthPath(`/invite?token=${token}`)
  const preview = useQuery({
    queryKey: ['invitation-link-preview', token?.slice(0, 12) ?? 'invalid'],
    queryFn: () => invitationLinks.preview(token!),
    enabled: token !== null,
    retry: false,
  })
  const claim = useMutation({
    mutationFn: () => invitationLinks.claim(token!),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
    },
  })
  const invitation = preview.data
  const expectedRole = invitation?.targetRole
  const switchAccount = useMutation({
    mutationFn: async () => {
      savePendingInvitation(returnTo, sessionStorage, expectedRole)
      await signOut()
      navigate('/auth', {
        replace: true,
        state: { from: returnTo, invitationRole: expectedRole },
      })
    },
  })
  const wrongRole = actor !== null && expectedRole !== undefined && actor.role !== expectedRole

  if (token === null || returnTo === null) return <AuthIdentityScreen>
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">ПРИГЛАШЕНИЕ</p>
      <h1>Ссылка недействительна</h1>
      <p className="muted">Попросите отправителя создать и прислать новое приглашение.</p>
    </header>
    <Link className="auth-back-link" to="/auth">Перейти ко входу</Link>
  </AuthIdentityScreen>

  if (preview.isPending || authLoading) return <AuthIdentityScreen>
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">ПРИГЛАШЕНИЕ</p>
      <h1>Открываем приглашение</h1>
    </header>
    <StatePanel tone="info" title="Проверяем ссылку" description="Это займёт несколько секунд…" />
  </AuthIdentityScreen>

  if (preview.isError) return <AuthIdentityScreen>
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">ПРИГЛАШЕНИЕ</p>
      <h1>Не удалось открыть ссылку</h1>
    </header>
    <StatePanel
      tone="error"
      title="Приглашение временно недоступно"
      description={preview.error instanceof RepositoryError
        ? preview.error.message
        : 'Проверьте интернет и попробуйте ещё раз.'}
      action={<button className="secondary" type="button" onClick={() => void preview.refetch()}>Повторить</button>}
    />
  </AuthIdentityScreen>

  if (invitation === null || invitation === undefined || invitation.status !== 'active') {
    const state = invitation?.status
    const title = state === 'claimed'
      ? 'Приглашение уже принято'
      : state === 'revoked'
        ? 'Приглашение отменено'
        : state === 'expired'
          ? 'Срок приглашения истёк'
          : 'Ссылка недействительна'
    return <AuthIdentityScreen>
      <header className="auth-entry-head">
        <div className="brand" aria-hidden="true">FIT</div>
        <p className="eyebrow">ПРИГЛАШЕНИЕ</p>
        <h1>{title}</h1>
        <p className="muted">Попросите отправителя создать новое приглашение, если подключение ещё нужно.</p>
      </header>
      <Link className="auth-back-link" to={actor?.role === 'client' ? '/me' : actor ? '/today' : '/auth'}>
        {actor ? 'Вернуться в FIT' : 'Перейти ко входу'}
      </Link>
    </AuthIdentityScreen>
  }

  const invitationText = invitation.targetRole === 'trainer'
    ? `${invitation.inviterName} приглашает вас стать тренером в Fit.`
    : `${invitation.inviterName} приглашает вас тренироваться вместе в Fit.`

  if (claim.isSuccess) return <AuthIdentityScreen>
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">ГОТОВО</p>
      <h1>{invitation.targetRole === 'client' ? 'Тренер подключён' : 'Клиент подключён'}</h1>
      <p className="muted">Связь создана. Можно продолжить работу в Fit.</p>
    </header>
    <button className="primary" type="button" onClick={() => navigate(
      invitation.targetRole === 'client' ? '/me' : `/clients/${claim.data}`,
      { replace: true },
    )}>{invitation.targetRole === 'client' ? 'Открыть кабинет' : 'Открыть карточку'}</button>
  </AuthIdentityScreen>

  return <AuthIdentityScreen className="invitation-link-page">
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">ПРИГЛАШЕНИЕ В FIT</p>
      <h1>{invitation.targetRole === 'trainer' ? 'Стать тренером' : 'Тренироваться вместе'}</h1>
      <p className="muted">{invitationText}</p>
    </header>
    <section className="join-card join-invitation">
      <div className="join-card-head">
        <strong>Приглашение действует до {invitationExpiry(invitation.expiresAt)}</strong>
        <p>Подключение произойдёт только после вашего подтверждения.</p>
      </div>
      {wrongRole && <div className="join-reconnect" role="alert">
        <strong>Это приглашение предназначено {invitation.targetRole === 'trainer' ? 'тренеру' : 'спортсмену'}</strong>
        <p>Войдите под аккаунтом с нужным типом. Роль текущего аккаунта автоматически не изменится.</p>
        {switchAccount.error && <p className="error">Не удалось выйти. Попробуйте ещё раз.</p>}
        <button
          className="secondary"
          type="button"
          aria-busy={switchAccount.isPending}
          disabled={switchAccount.isPending}
          onClick={() => switchAccount.mutate()}
        >{switchAccount.isPending ? 'Выходим…' : 'Войти под другим аккаунтом'}</button>
      </div>}
      {claim.error && <p className="error" role="alert">{claim.error instanceof RepositoryError
        ? claim.error.message
        : 'Не удалось принять приглашение. Попробуйте ещё раз.'}</p>}
      {actor === null ? <div className="stack">
        <Link className="button primary" to="/auth" state={{ from: returnTo, invitationRole: invitation.targetRole }}>
          Войти и подключиться
        </Link>
        <Link className="button secondary" to="/auth" state={{
          from: returnTo,
          invitationRole: invitation.targetRole,
          mode: 'register',
        }}>Зарегистрироваться</Link>
      </div> : !wrongRole && <button
        className="primary wide"
        type="button"
        aria-busy={claim.isPending}
        disabled={claim.isPending}
        onClick={() => claim.mutate()}
      >{claim.isPending ? 'Подключаем…' : 'Подключиться'}</button>}
    </section>
    <nav className="auth-legal-links" aria-label="Юридическая информация">
      <Link to="/legal/terms">Условия использования</Link>
      <Link to="/legal/privacy">Конфиденциальность</Link>
    </nav>
  </AuthIdentityScreen>
}

export function JoinPage() {
  const { invitations: invitationsRepository } = useDataBackend()
  const { actor } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const claim = useMutation({
    mutationFn: (code: string) => actor?.role === 'client'
      ? invitationsRepository.reconnect(code)
      : invitationsRepository.claim(code),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
    },
  })

  const codeFromLink = searchParams.get('code')
  const isClient = actor?.role === 'client'
  const backPath = isClient ? '/me/profile' : '/clients'
  const requiresDisconnect = claim.error instanceof RepositoryError
    && claim.error.code === 'trainer_disconnect_required'

  function connect(code: string) {
    const normalizedCode = code.trim().toUpperCase()
    if (!normalizedCode) return
    setSearchParams({ code: normalizedCode }, { replace: true })
    claim.mutate(normalizedCode)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    connect(String(new FormData(event.currentTarget).get('code')))
  }

  if (claim.isSuccess) {
    return <Page title="Подключение" back={backPath} swipeBack className="join-page">
      <section className="join-card join-success" role="status" aria-live="polite">
        <div className="join-card-head">
          <p className="eyebrow">ГОТОВО</p>
          <h2>{isClient ? 'Тренер подключён' : 'Клиент подключён'}</h2>
          <p>{isClient
            ? 'Ваши самостоятельные тренировки сохранены. Планы тренера уже доступны в кабинете.'
            : 'Карточка клиента и доступная история тренировок готовы к работе.'}</p>
        </div>
        <button
          className="primary wide"
          onClick={() => navigate(isClient ? '/me' : `/clients/${claim.data}`, { replace: true })}
        >
          {isClient ? 'Открыть кабинет' : 'Открыть карточку'}
        </button>
      </section>
    </Page>
  }

  return <Page title="Подключение" back={backPath} swipeBack className="join-page">
    {codeFromLink ? <section className="join-card join-invitation"><div className="join-card-head"><p className="eyebrow">ПРИГЛАШЕНИЕ</p><h2>{isClient ? 'Тренер пригласил вас в Fit' : 'Клиент пригласил вас в Fit'}</h2><p>{isClient ? 'После подключения вы увидите планы тренировок и сможете отправлять тренеру результаты.' : 'После подключения карточка клиента появится в вашем списке.'}</p></div>
      {requiresDisconnect ? <div className="join-reconnect" role="alert">
        <strong>Сначала отключите текущего тренера</strong>
        <p>Откройте профиль и отключите текущего тренера. Ваш аккаунт, тренировки, замеры и цели сохранятся.</p>
        <p className="muted">После отключения вернитесь назад — код останется на этом экране.</p>
        <Link className="button secondary" to="/me/profile">Открыть профиль</Link>
      </div> : claim.error && <p className="error" role="alert">{claim.error.message}</p>}
      <button className="primary wide" disabled={claim.isPending || requiresDisconnect} onClick={() => connect(codeFromLink)}>{claim.isPending ? 'Подключаем…' : requiresDisconnect ? 'Сначала отключите тренера' : isClient ? 'Подключиться и открыть план' : 'Подключить клиента'}</button>
    </section> : <section className="join-card"><div className="join-card-head"><p className="eyebrow">ПОДКЛЮЧЕНИЕ</p><h2>{isClient ? 'Введите код тренера' : 'Введите код клиента'}</h2><p>{isClient ? 'Введите 12-значный код, который прислал тренер.' : 'Введите 12-значный код, который прислал клиент.'}</p></div><form className="stack compact join-form" onSubmit={submit}>
      <Field label="Код приглашения"><input name="code" defaultValue={codeFromLink ?? ''} minLength={12} maxLength={12} autoCapitalize="characters" required /></Field>
      {requiresDisconnect ? <div className="join-reconnect" role="alert">
        <strong>Сначала отключите текущего тренера</strong>
        <p>Откройте профиль и отключите текущего тренера. Ваш аккаунт, тренировки, замеры и цели сохранятся.</p>
        <p className="muted">После отключения вернитесь назад — код останется на этом экране.</p>
        <Link className="button secondary" to="/me/profile">Открыть профиль</Link>
      </div> : claim.error && <p className="error" role="alert">{claim.error.message}</p>}
      <button className="primary" disabled={claim.isPending}>{claim.isPending ? 'Подключаем…' : 'Присоединиться'}</button>
    </form></section>}
  </Page>
}
