import { useMutation } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { isDarkThemePilotEnabled, isLightThemePilotEnabled } from '../../app/feature-flags'
import { setRpeDisplay, useRpeDisplay } from '../../app/rpe-display'
import { setAppTheme, useAppTheme } from '../../app/theme'
import { authRepository } from '../../data/repositories/auth.repository'
import { Field, Page, SaveStatus, Switch } from '../../shared/ui'

export function ProfilePage() {
  const { actor, refresh } = useAuth(); const navigate = useNavigate(); const [saved, setSaved] = useState(false)
  const theme = useAppTheme()
  const showRpe = useRpeDisplay(actor?.userId)
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
  // Переключатель остаётся «светлая/тёмная». Пилотные палитры подставляет
  // allowlist, поэтому вариант считается здесь же, без задержки на один кадр.
  function toggleTheme(dark: boolean) {
    setAppTheme(dark ? 'dark' : 'light', {
      light: Boolean(actor && isLightThemePilotEnabled(actor.userId)),
      dark: Boolean(actor && isDarkThemePilotEnabled(actor.userId)),
    })
  }
  function toggleShowArchived(checked: boolean) {
    setShowArchived(checked)
    localStorage.setItem('fit.showArchivedClients', String(checked))
  }
  return <Page title="Профиль" className="profile-page"><form ref={formRef} className="stack profile-form" onSubmit={(event) => void submit(event)}><section className="profile-form-section"><div className="profile-form-section-head"><p className="eyebrow">МОЙ ПРОФИЛЬ</p><h2>Основные данные</h2></div><Field label="Имя"><input name="firstName" defaultValue={actor?.firstName ?? ''} /></Field><Field label="Фамилия"><input name="lastName" defaultValue={actor?.lastName ?? ''} /></Field><Field label="Часовой пояс"><input name="timezone" defaultValue={actor?.timezone ?? 'Europe/Moscow'} /></Field><SaveStatus status={update.isPending ? 'saving' : update.error ? 'error' : saved ? 'saved' : 'idle'} error={update.error?.message} /></section><div className="actions"><button type="button" className="secondary" onClick={cancel}>Отмена</button><button disabled={update.isPending}>Сохранить</button></div></form><section className="profile-settings" aria-label="Настройки"><Switch label="Тёмная тема" checked={theme === 'dark'} onChange={toggleTheme} />{actor?.role === 'trainer' && <Switch label="Показывать RPE в подходах" checked={showRpe} onChange={(checked) => setRpeDisplay(actor.userId, checked)} />}{actor?.role === 'trainer' && <Switch label="Показывать архив клиентов" checked={showArchived} onChange={toggleShowArchived} />}</section><div className="menu"><Link to="/join">Ввести код приглашения</Link>{actor?.role === 'trainer' && <Link to="/exercises">Управление упражнениями</Link>}</div><button className="danger secondary wide" onClick={() => void logout()}>Выйти</button></Page>
}
