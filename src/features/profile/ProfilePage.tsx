import { CorporateServiceEntry } from '../corporate-services'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { isCoachLiveDensityEnabled } from '../../app/coach-workout-redesign'
import { setCoachLiveDensity, useCoachLiveDensity } from '../../app/coach-live-density'
import { setExercisePlanRestDisplay, useExercisePlanRestDisplay } from '../../app/exercise-plan-display'
import { setLiveExerciseAnimation, useLiveExerciseAnimation } from '../../app/live-exercise-animation'
import { setRpeDisplay, useRpeDisplay } from '../../app/rpe-display'
import { setWorkoutTimeWheel, useWorkoutTimeWheel } from '../../app/workout-time-input'
import { setAppTheme, useAppTheme } from '../../app/theme'
import { isFitLimeShellRoute } from '../../app/fit-lime'
import { SettingsIcon } from '../../shared/icons'
import { LEGAL_PATHS } from '../../shared/legal'
import { SUPPORT_TELEGRAM_URL } from '../../shared/support'
import { Coachmark, Page, Switch } from '../../shared/ui'
import { AppInstallPanel } from '../install'
import { FitLimeInstallSetting } from '../install/FitLimeInstallSetting'
import { NotificationsSetting } from '../notifications'
import { BodyMapAppearanceSetting } from '../progress/BodyMapAppearanceSetting'
import { AppFeedbackForm } from './AppFeedbackForm'
import { AccountSettingsCard, SettingsSection } from './SettingsSection'
import { TrainerProfessionalProfileSection } from './TrainerProfileEditorPage'
import { ScheduleDensitySetting } from './ScheduleDensitySetting'
import { TRAINER_SETTINGS_SECTIONS, TrainerSettingsOverview, trainerSettingsSection } from './TrainerSettingsOverview'

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
    <CorporateServiceEntry />
  </Page>
}

export function TrainerProfileSettingsPage() {
  const [params] = useSearchParams()
  const section = trainerSettingsSection(params.get('section'))
  const { actor } = useAuth()
  const theme = useAppTheme()
  const showRpe = useRpeDisplay(actor?.userId)
  const useTimeWheel = useWorkoutTimeWheel()
  const showExerciseRest = useExercisePlanRestDisplay(actor?.userId)
  const showLiveExerciseAnimation = useLiveExerciseAnimation(actor?.userId, !isCoachLiveDensityEnabled(actor))
  const liveDensity = useCoachLiveDensity(actor?.userId)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const fitLimeSettings = isFitLimeShellRoute(actor, '/profile/settings', '')

  if (!actor || actor.role !== 'trainer') return null

  return <Page title={section ? TRAINER_SETTINGS_SECTIONS[section] : 'Настройки'} back={section ? '/profile/settings' : '/profile'} swipeBack className="profile-page profile-settings-page settings-page trainer-compact-settings">
    {!section && <TrainerSettingsOverview actor={actor} />}
    {section === 'install' && <SettingsSection title="Приложение">{fitLimeSettings ? <FitLimeInstallSetting /> : <AppInstallPanel onClose={() => setInstallOpen(false)} />}</SettingsSection>}
    {section === 'notifications' && <SettingsSection title="Уведомления">
      <div className="profile-settings"><NotificationsSetting userId={actor.userId} role="trainer" /></div>
    </SettingsSection>}

    {section === 'training' && <>
    <SettingsSection title="Live-тренировка">
      <div className="profile-settings">
        {isCoachLiveDensityEnabled(actor) && <div className="schedule-density-setting coach-live-density-setting">
          <div><strong>Вид Live-тренировки</strong><span>Выбор сохраняется для вашей учётки на этом устройстве.</span></div>
          <div className="schedule-density-options" role="radiogroup" aria-label="Вид Live-тренировки">
            {(['original', 'compact'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={liveDensity === value} tabIndex={liveDensity === value ? 0 : -1} onClick={() => setCoachLiveDensity(actor.userId, value)} onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 'original' : event.key === 'End' ? 'compact' : value === 'original' ? 'compact' : 'original'
              setCoachLiveDensity(actor.userId, next)
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next === 'original' ? 0 : 1]?.focus()
            }}>{value === 'original' ? 'Оригинальный' : 'Компактный'}</button>)}
          </div>
        </div>}
        <Switch label="Анимация упражнения" checked={showLiveExerciseAnimation} onChange={(checked) => setLiveExerciseAnimation(actor.userId, checked)} />
      </div>
    </SettingsSection>
    <SettingsSection title="Ввод и поля">
      <div className="profile-settings">
        <Switch label="Ввод времени колёсиком" checked={useTimeWheel} onChange={setWorkoutTimeWheel} />
        <Switch label="Отдых в плане" checked={showExerciseRest} onChange={(checked) => setExercisePlanRestDisplay(actor.userId, checked)} />
        <Switch label="Показывать RPE" checked={showRpe} onChange={(checked) => setRpeDisplay(actor.userId, checked)} />
      </div>
    </SettingsSection>
    </>}

    {section === 'schedule' && <SettingsSection title="Расписание">
      <ScheduleDensitySetting />
    </SettingsSection>}

    {section === 'appearance' && <SettingsSection title="Оформление">
      {fitLimeSettings && <p className="fit-lime-profile-theme-note">Экраны Lime сохраняют тёмное оформление. Выбор темы применяется к остальным экранам.</p>}
      <div className="profile-settings"><Switch label={fitLimeSettings ? 'Тёмная тема остальных экранов' : 'Тёмная тема'} checked={theme === 'dark'} onChange={(dark) => setAppTheme(dark ? 'dark' : 'light')} /></div>
      <BodyMapAppearanceSetting viewerUserId={actor.userId} role={actor.role} gender={null} />
    </SettingsSection>}

    {section === 'account' && <SettingsSection title="Данные аккаунта">
      <AccountSettingsCard />
      <div className="menu"><Link to={LEGAL_PATHS.deleteAccount}>Удаление аккаунта</Link></div>
    </SettingsSection>}

    {section === 'help' && <SettingsSection title="Помощь и документы">
      <div className="menu">
        <button type="button" aria-expanded={installOpen} onClick={() => setInstallOpen((value) => !value)}>Fit на экране «Домой»</button>
        <button type="button" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen((value) => !value)}>Предложение или проблема</button>
        <a href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer">Поддержка в Telegram</a>
        <Link to={LEGAL_PATHS.terms}>Условия использования</Link>
        <Link to={LEGAL_PATHS.privacy}>Политика конфиденциальности</Link>
      </div>
      {installOpen && <AppInstallPanel onClose={() => setInstallOpen(false)} />}
      {feedbackOpen && <AppFeedbackForm onClose={() => setFeedbackOpen(false)} />}
    </SettingsSection>}
  </Page>
}
