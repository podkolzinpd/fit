import { useMutation } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { setAppTheme, useAppTheme } from '../../app/theme'
import { authRepository } from '../../data/repositories/auth.repository'
import { Field, Page, SaveStatus } from '../../shared/ui'

export function ProfilePage() {
  const { actor, refresh } = useAuth(); const navigate = useNavigate(); const [saved, setSaved] = useState(false)
  const theme = useAppTheme()
  const [showArchived, setShowArchived] = useState(() => localStorage.getItem('fit.showArchivedClients') === 'true')
  const formRef = useRef<HTMLFormElement>(null)
  const update = useMutation({ mutationFn: async (form: HTMLFormElement) => {
    if (!actor || actor.kind !== 'trainer') throw new Error('Профиль тренера недоступен')
    const data = new FormData(form)
    await authRepository.updateProfile({ ...actor, firstName: String(data.get('firstName') || '') || null, lastName: String(data.get('lastName') || '') || null, timezone: String(data.get('timezone')) })
  }, onSuccess: async () => { setSaved(true); await refresh() } })
  async function logout() { await authRepository.signOut(); navigate('/auth') }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaved(false); update.mutate(event.currentTarget) }
  // Отмена сбрасывает несохранённые правки к текущим значениям профиля.
  function cancel() { formRef.current?.reset(); setSaved(false) }
  function toggleShowArchived(checked: boolean) {
    setShowArchived(checked)
    localStorage.setItem('fit.showArchivedClients', String(checked))
  }
  return <Page title="Профиль"><form ref={formRef} className="stack" onSubmit={(event) => void submit(event)}><Field label="Имя"><input name="firstName" defaultValue={actor?.firstName ?? ''} /></Field><Field label="Фамилия"><input name="lastName" defaultValue={actor?.lastName ?? ''} /></Field><Field label="Часовой пояс"><input name="timezone" defaultValue={actor?.timezone ?? 'Europe/Moscow'} /></Field><SaveStatus status={update.isPending ? 'saving' : update.error ? 'error' : saved ? 'saved' : 'idle'} error={update.error?.message} /><div className="actions"><button type="button" className="secondary" onClick={cancel}>Отмена</button><button disabled={update.isPending}>Сохранить</button></div></form><label className="toggle"><input type="checkbox" checked={theme === 'dark'} onChange={(event) => setAppTheme(event.target.checked ? 'dark' : 'light')} /> Тёмная тема</label>{actor?.role === 'trainer' && <label className="toggle"><input type="checkbox" checked={showArchived} onChange={(event) => toggleShowArchived(event.target.checked)} /> Показывать архив клиентов</label>}<div className="menu"><Link to="/join">Ввести код приглашения</Link>{actor?.role === 'trainer' && <Link to="/exercises">Управление упражнениями</Link>}</div><button className="danger secondary wide" onClick={() => void logout()}>Выйти</button></Page>
}
