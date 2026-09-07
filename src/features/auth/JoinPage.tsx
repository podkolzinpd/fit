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
    const isClient = actor?.role === 'client'
    return <Page title="Присоединиться" className="join-page">
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

  return <Page title="Присоединиться" className="join-page">
    {codeFromLink ? <section className="join-card join-invitation"><div className="join-card-head"><p className="eyebrow">ПРИГЛАШЕНИЕ</p><h2>Тренер пригласил вас в Fit</h2><p>После подключения вы увидите планы тренировок и сможете отправлять тренеру результаты.</p></div>
      {requiresDisconnect ? <div className="join-reconnect" role="alert">
        <strong>Сначала отключите текущего тренера</strong>
        <p>Откройте профиль и отключите текущего тренера. Ваш аккаунт, тренировки, замеры и цели сохранятся.</p>
        <p className="muted">После отключения вернитесь назад — код останется на этом экране.</p>
        <Link className="button secondary" to="/me/profile">Открыть профиль</Link>
      </div> : claim.error && <p className="error" role="alert">{claim.error.message}</p>}
      <button className="primary wide" disabled={claim.isPending || requiresDisconnect} onClick={() => connect(codeFromLink)}>{claim.isPending ? 'Подключаем…' : requiresDisconnect ? 'Сначала отключите тренера' : 'Подключиться и открыть план'}</button>
    </section> : <section className="join-card"><div className="join-card-head"><p className="eyebrow">СВЯЗЬ С ТРЕНЕРОМ</p><h2>Введите код приглашения</h2><p>Код из 12 символов свяжет ваш профиль с тренером.</p></div><form className="stack compact join-form" onSubmit={submit}>
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
