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
    onSuccess: async (clientId) => {
      await queryClient.invalidateQueries()
      navigate(actor?.role === 'client' ? '/me' : `/clients/${clientId}`, { replace: true })
    },
  })

  const codeFromLink = searchParams.get('code')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    claim.mutate(String(new FormData(event.currentTarget).get('code')))
  }

  return <Page title="Присоединиться" className="join-page">
    {codeFromLink ? <section className="join-card join-invitation"><div className="join-card-head"><p className="eyebrow">ПРИГЛАШЕНИЕ</p><h2>Тренер пригласил вас в Fit</h2><p>После подключения вы увидите планы тренировок и сможете отправлять тренеру результаты.</p></div>
      {claim.error && <p className="error" role="alert">{claim.error.message}</p>}
      <button className="wide" disabled={claim.isPending} onClick={() => claim.mutate(codeFromLink)}>{claim.isPending ? 'Подключаем…' : 'Подключиться и открыть план'}</button>
    </section> : <section className="join-card"><div className="join-card-head"><p className="eyebrow">СВЯЗЬ С ТРЕНЕРОМ</p><h2>Введите код приглашения</h2><p>Код из 12 символов свяжет ваш профиль с тренером.</p></div><form className="stack compact join-form" onSubmit={submit}>
      <Field label="Код приглашения"><input name="code" defaultValue={codeFromLink ?? ''} minLength={12} maxLength={12} autoCapitalize="characters" required /></Field>
      {claim.error && <p className="error" role="alert">{claim.error.message}</p>}
      <button disabled={claim.isPending}>{claim.isPending ? 'Подключаем…' : 'Присоединиться'}</button>
    </form></section>}
  </Page>
}
