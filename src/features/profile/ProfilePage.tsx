import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useOptionalYandexAppSession } from '../../app/yandex-app-session-context'
import { setExercisePlanRestDisplay, useExercisePlanRestDisplay } from '../../app/exercise-plan-display'
import { setLiveExerciseAnimation, useLiveExerciseAnimation } from '../../app/live-exercise-animation'
import { setRpeDisplay, useRpeDisplay } from '../../app/rpe-display'
import { setAppTheme, useAppTheme } from '../../app/theme'
import { SettingsIcon } from '../../shared/icons'
import { LEGAL_PATHS } from '../../shared/legal'
import { Coachmark, Page, Switch } from '../../shared/ui'
import { LogoutButton, YandexAccountLinkingCard } from '../auth'
import { AppInstallPanel } from '../install'
import { NotificationsSetting } from '../notifications'
import { BodyMapAppearanceSetting } from '../progress/BodyMapAppearanceSetting'
import { AppFeedbackForm } from './AppFeedbackForm'
import { AccountSettingsCard, SettingsSection } from './SettingsSection'
import { TrainerProfessionalProfileSection } from './TrainerProfileEditorPage'

export function ProfilePage() {
  const { actor } = useAuth()
  return <Page title="Профиль" className="profile-page" action={<Coachmark
    id="trainer-profile-settings-2026-09"
    userId={actor?.userId}
    title="Настройки переехали"
    description="Тема, параметры тренировок и аккаунт теперь открываются по шестерёнке."
  >
    <Link className="profile-settings-link" to="/profile/settings" aria-label="Настройки профиля"><SettingsIcon /></Link>
  </Coachmark>}>
    <TrainerProfessionalProfileSection />
  </Page>
}

export function TrainerProfileSettingsPage() {
  const { actor } = useAuth()
  const yandexSession = useOptionalYandexAppSession()?.session ?? null
  const theme = useAppTheme()
  const showRpe = useRpeDisplay(actor?.userId)
  const showExerciseRest = useExercisePlanRestDisplay(actor?.userId)
  const showLiveExerciseAnimation = useLiveExerciseAnimation(actor?.userId)
  const [showArchived, setShowArchived] = useState(() => localStorage.getItem('fit.showArchivedClients') === 'true')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)

  function toggleShowArchived(checked: boolean) {
    setShowArchived(checked)
    localStorage.setItem('fit.showArchivedClients', String(checked))
  }

  if (!actor || actor.role !== 'trainer') return null

  return <Page title="Настройки" back="/profile" swipeBack className="profile-page profile-settings-page settings-page">
    <SettingsSection title="Уведомления">
      <div className="profile-settings"><NotificationsSetting userId={actor.userId} role="trainer" /></div>
    </SettingsSection>

    <SettingsSection title="Тренировки">
      <div className="profile-settings">
        <Switch label="Анимация упражнения" checked={showLiveExerciseAnimation} onChange={(checked) => setLiveExerciseAnimation(actor.userId, checked)} />
        <Switch label="Показывать отдых" checked={showExerciseRest} onChange={(checked) => setExercisePlanRestDisplay(actor.userId, checked)} />
        <Switch label="Показывать RPE" checked={showRpe} onChange={(checked) => setRpeDisplay(actor.userId, checked)} />
        <Switch label="Показывать архив клиентов" checked={showArchived} onChange={toggleShowArchived} />
      </div>
    </SettingsSection>

    <SettingsSection title="Оформление">
      <div className="profile-settings"><Switch label="Тёмная тема" checked={theme === 'dark'} onChange={(dark) => setAppTheme(dark ? 'dark' : 'light')} /></div>
      <BodyMapAppearanceSetting viewerUserId={actor.userId} role={actor.role} gender={null} />
    </SettingsSection>

    <SettingsSection title="Рабочие инструменты">
      <div className="menu"><Link to="/exercises">Управление упражнениями</Link><Link to="/join">Ввести код приглашения</Link></div>
    </SettingsSection>

    <SettingsSection title="Аккаунт и помощь">
      <AccountSettingsCard />
      {yandexSession === null && <YandexAccountLinkingCard actor={actor} />}
      <div className="menu">
        <button type="button" aria-expanded={installOpen} onClick={() => setInstallOpen((value) => !value)}>Fit на экране «Домой»</button>
        <button type="button" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen((value) => !value)}>Предложение или проблема</button>
        <Link to={LEGAL_PATHS.terms}>Условия использования</Link>
        <Link to={LEGAL_PATHS.privacy}>Политика конфиденциальности</Link>
        <Link to={LEGAL_PATHS.deleteAccount}>Удаление аккаунта</Link>
      </div>
      {installOpen && <AppInstallPanel onClose={() => setInstallOpen(false)} />}
      {feedbackOpen && <AppFeedbackForm onClose={() => setFeedbackOpen(false)} />}
      <LogoutButton />
    </SettingsSection>
  </Page>
}
