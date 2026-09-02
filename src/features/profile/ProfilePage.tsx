import { useMutation } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { setExercisePlanRestDisplay, useExercisePlanRestDisplay } from '../../app/exercise-plan-display'
import { setRpeDisplay, useRpeDisplay } from '../../app/rpe-display'
import { setAppTheme, useAppTheme } from '../../app/theme'
import { authRepository } from '../../data/repositories/auth.repository'
import { Field, Page, SaveStatus, Switch } from '../../shared/ui'
import { YandexAccountLinkingCard } from '../auth'
import { AppFeedbackForm } from './AppFeedbackForm'
import { AppInstallPanel } from '../install'
import { BodyMapAppearanceSetting } from '../progress/BodyMapAppearanceSetting'

export function ProfilePage() {
  const { actor, refresh } = useAuth(); const navigate = useNavigate(); const [saved, setSaved] = useState(false)
  const theme = useAppTheme()
  const showRpe = useRpeDisplay(actor?.userId)
  const showExerciseRest = useExercisePlanRestDisplay(actor?.userId)
  const [showArchived, setShowArchived] = useState(() => localStorage.getItem('fit.showArchivedClients') === 'true')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
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
  function toggleTheme(dark: boolean) {
    setAppTheme(dark ? 'dark' : 'light')
  }
  function toggleShowArchived(checked: boolean) {
    setShowArchived(checked)
    localStorage.setItem('fit.showArchivedClients', String(checked))
  }
  return <Page title="Профиль" className="profile-page">
    <form ref={formRef} className="stack profile-form" onSubmit={(event) => void submit(event)}>
      <section className="profile-form-section">
        <div className="profile-form-section-head"><p className="eyebrow">МОЙ ПРОФИЛЬ</p><h2>Основные данные</h2></div>
        <Field label="Имя"><input name="firstName" defaultValue={actor?.firstName ?? ''} /></Field>
        <Field label="Фамилия"><input name="lastName" defaultValue={actor?.lastName ?? ''} /></Field>
        <Field label="Часовой пояс"><input name="timezone" defaultValue={actor?.timezone ?? 'Europe/Moscow'} /></Field>
        <SaveStatus status={update.isPending ? 'saving' : update.error ? 'error' : saved ? 'saved' : 'idle'} error={update.error?.message} />
      </section>
      <div className="actions"><button type="button" className="secondary" onClick={cancel}>Отмена</button><button className="primary" disabled={update.isPending}>Сохранить</button></div>
    </form>
    <section className="profile-settings" aria-label="Настройки">
      <Switch label="Тёмная тема" checked={theme === 'dark'} onChange={toggleTheme} />
      {actor?.role === 'trainer' && <>
        <div className="profile-settings-group-head"><strong>Поля плана упражнений</strong><span>Выберите данные, которые всегда видны при составлении тренировки.</span></div>
        <Switch label="Всегда показывать отдых между подходами" checked={showExerciseRest} onChange={(checked) => setExercisePlanRestDisplay(actor.userId, checked)} />
        <Switch label="Всегда показывать RPE в подходах" checked={showRpe} onChange={(checked) => setRpeDisplay(actor.userId, checked)} />
        <Switch label="Показывать архив клиентов" checked={showArchived} onChange={toggleShowArchived} />
      </>}
    </section>
    {actor && <YandexAccountLinkingCard actor={actor} />}
    {actor?.role === 'trainer' && <BodyMapAppearanceSetting viewerUserId={actor.userId} role={actor.role} gender={null} />}
    <div className="menu"><Link to="/join">Ввести код приглашения</Link>{actor?.role === 'trainer' && <Link to="/exercises">Управление упражнениями</Link>}<button type="button" aria-expanded={installOpen} onClick={() => setInstallOpen((value) => !value)}>Fit на экране «Домой»</button><button type="button" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen((value) => !value)}>Предложение или проблема</button></div>
    {installOpen && <AppInstallPanel onClose={() => setInstallOpen(false)} />}
    {feedbackOpen && <AppFeedbackForm onClose={() => setFeedbackOpen(false)} />}
    <button className="danger secondary wide" onClick={() => void logout()}>Выйти</button>
  </Page>
}
