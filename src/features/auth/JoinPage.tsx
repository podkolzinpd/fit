import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { invitationsRepository } from '../../data/repositories/invitations.repository'
import { Field, Page } from '../../shared/ui'

export function JoinPage() {
  const { actor } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const claim = useMutation({
    mutationFn: (code: string) => invitationsRepository.claim(code),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
    },
  })

  const codeFromLink = searchParams.get('code')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    claim.mutate(String(new FormData(event.currentTarget).get('code')))
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
      {claim.error && <p className="error" role="alert">{claim.error.message}</p>}
      <button className="primary wide" disabled={claim.isPending} onClick={() => claim.mutate(codeFromLink)}>{claim.isPending ? 'Подключаем…' : 'Подключиться и открыть план'}</button>
    </section> : <section className="join-card"><div className="join-card-head"><p className="eyebrow">СВЯЗЬ С ТРЕНЕРОМ</p><h2>Введите код приглашения</h2><p>Код из 12 символов свяжет ваш профиль с тренером.</p></div><form className="stack compact join-form" onSubmit={submit}>
      <Field label="Код приглашения"><input name="code" defaultValue={codeFromLink ?? ''} minLength={12} maxLength={12} autoCapitalize="characters" required /></Field>
      {claim.error && <p className="error" role="alert">{claim.error.message}</p>}
      <button className="primary" disabled={claim.isPending}>{claim.isPending ? 'Подключаем…' : 'Присоединиться'}</button>
    </form></section>}
  </Page>
}
