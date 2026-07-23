import { useMutation } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { authRepository } from '../../data/repositories/auth.repository'
import { Field, Page } from '../../shared/ui'

export function ProfilePage() {
  const { actor, refresh } = useAuth(); const navigate = useNavigate(); const [saved, setSaved] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const update = useMutation({ mutationFn: async (form: HTMLFormElement) => { const data = new FormData(form); await authRepository.updateProfile({ ...actor!, firstName: String(data.get('firstName') || '') || null, lastName: String(data.get('lastName') || '') || null, timezone: String(data.get('timezone')) }) }, onSuccess: async () => { setSaved(true); await refresh() } })
  async function logout() { await authRepository.signOut(); navigate('/auth') }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); update.mutate(event.currentTarget) }
  // Отмена сбрасывает несохранённые правки к текущим значениям профиля.
  function cancel() { formRef.current?.reset(); setSaved(false) }
  return <Page title="Профиль"><form ref={formRef} className="stack" onSubmit={(event) => void submit(event)}><Field label="Имя"><input name="firstName" defaultValue={actor?.firstName ?? ''} /></Field><Field label="Фамилия"><input name="lastName" defaultValue={actor?.lastName ?? ''} /></Field><Field label="Часовой пояс"><input name="timezone" defaultValue={actor?.timezone ?? 'Europe/Moscow'} /></Field>{update.error && <p className="error">{update.error.message}</p>}{saved && <p className="success">Сохранено</p>}<div className="actions"><button type="button" className="secondary" onClick={cancel}>Отмена</button><button disabled={update.isPending}>Сохранить</button></div></form><div className="menu"><Link to="/exercises">Управление упражнениями</Link></div><button className="danger secondary wide" onClick={() => void logout()}>Выйти</button></Page>
}
