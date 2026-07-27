import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, type FormEvent } from 'react'
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
  useEffect(() => {
    if (codeFromLink && !claim.isPending && !claim.isSuccess) claim.mutate(codeFromLink)
  }, [codeFromLink, claim])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    claim.mutate(String(new FormData(event.currentTarget).get('code')))
  }

  return <Page title="Присоединиться">
    {codeFromLink && claim.isPending ? <p className="state">Проверяем приглашение…</p> : <form className="stack" onSubmit={submit}>
      <Field label="Код приглашения"><input name="code" minLength={12} maxLength={12} autoCapitalize="characters" required /></Field>
      {claim.error && <p className="error" role="alert">{claim.error.message}</p>}
      <button disabled={claim.isPending}>{claim.isPending ? 'Подключаем…' : 'Присоединиться'}</button>
    </form>}
  </Page>
}
