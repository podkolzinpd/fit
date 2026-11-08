import { useMutation } from '@tanstack/react-query'
import { useId, useRef, useState, type FormEvent, type PropsWithChildren } from 'react'
import { useAuth } from '../../app/auth-context'
import { Field, SaveStatus } from '../../shared/ui'

export function SettingsSection({ title, children }: PropsWithChildren<{ title: string }>) {
  const headingId = useId()
  return <section className="settings-section" aria-labelledby={headingId}>
    <h2 id={headingId}>{title}</h2>
    {children}
  </section>
}

export function AccountSettingsCard() {
  const { actor, refresh, updateProfile } = useAuth()
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const update = useMutation({
    mutationFn: async (data: FormData) => {
      if (!actor || actor.kind !== 'trainer') throw new Error('Изменение данных недоступно')
      await updateProfile({
        firstName: String(data.get('firstName') || '') || null,
        lastName: String(data.get('lastName') || '') || null,
        timezone: String(data.get('timezone') || actor.timezone),
      })
    },
    onSuccess: async () => {
      await refresh()
      setSaved(true)
      setEditing(false)
    },
  })
  if (!actor) return null

  const name = [actor.firstName, actor.lastName].filter(Boolean).join(' ')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    update.mutate(new FormData(event.currentTarget))
  }
  function cancel() {
    update.reset()
    formRef.current?.reset()
    setSaved(false)
    setEditing(false)
  }

  return <div className="account-settings-card">
    <div className="account-settings-summary">
      <div>
        {name && <strong>{name}</strong>}
        {actor.email && <span>{actor.email}</span>}
        <span>{actor.timezone}</span>
      </div>
      {actor.kind === 'trainer' && !editing && <button type="button" className="link" onClick={() => { update.reset(); setSaved(false); setEditing(true) }}>Изменить данные</button>}
    </div>
    {actor.kind === 'trainer' && editing && <form ref={formRef} className="stack account-settings-form" onSubmit={submit}>
      <Field label="Имя"><input disabled={update.isPending} name="firstName" defaultValue={actor.firstName ?? ''} /></Field>
      <Field label="Фамилия"><input disabled={update.isPending} name="lastName" defaultValue={actor.lastName ?? ''} /></Field>
      <Field label="Часовой пояс"><input disabled={update.isPending} name="timezone" defaultValue={actor.timezone} /></Field>
      <SaveStatus status={update.isPending ? 'saving' : update.error ? 'error' : 'idle'} error={update.error?.message} />
      <div className="actions"><button type="button" className="secondary" disabled={update.isPending} onClick={cancel}>Отмена</button><button className="primary" disabled={update.isPending}>Сохранить</button></div>
    </form>}
    {saved && <SaveStatus status="saved" />}
  </div>
}
