import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { RepositoryError } from '../../data/repositories/error'
import { Field, Page } from '../../shared/ui'

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
