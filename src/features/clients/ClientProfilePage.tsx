import { isClientLimeEnabled } from '../../app/client-lime'
import { setClientLimeThemePreference, useClientLimeTheme } from '../../app/client-lime-theme'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { setAppTheme, useAppTheme } from '../../app/theme'
import { setLiveExerciseAnimation, useLiveExerciseAnimation } from '../../app/live-exercise-animation'
import { setWorkoutTimeWheel, useWorkoutTimeWheel } from '../../app/workout-time-input'
import { ChevronRightIcon, SettingsIcon } from '../../shared/icons'
import { LEGAL_PATHS } from '../../shared/legal'
import { SUPPORT_TELEGRAM_URL } from '../../shared/support'
import { AsyncView, Page, Switch } from '../../shared/ui'
import { LogoutButton } from '../auth'
import { AppInstallPanel } from '../install'
import { NotificationsSetting } from '../notifications'
import { AppFeedbackForm } from '../profile/AppFeedbackForm'
import { AccountSettingsCard, SettingsSection } from '../profile/SettingsSection'
import { BodyMapAppearanceSetting } from '../progress/BodyMapAppearanceSetting'
import { ClientTrainerConnections } from './ClientTrainerConnections'
import { ClientFinanceHomeCard } from '../finance'
import { SPORT_INTEREST_LABELS } from '../../shared/sport-interests'

export function ClientProfilePage() {
  const { actor } = useAuth()
  const { clients: clientsRepository, athleteSportProfile } = useDataBackend()
  const [showAllSports, setShowAllSports] = useState(false)
  const client = useQuery({
    queryKey: ['my-client'],
    queryFn: () => clientsRepository.getMine(),
    enabled: actor?.role === 'client',
  })
  const sport = useQuery({
    queryKey: ['my-sport-profile'], queryFn: () => athleteSportProfile.getMine(),
    enabled: actor?.role === 'client' && athleteSportProfile.supportsSportInterests,
  })
  if (!actor || actor.role !== 'client') return null

  return <Page title="Профиль" className="client-profile-page" action={<Link className="profile-settings-link" to="/me/settings" aria-label="Настройки профиля"><SettingsIcon /><span>Настройки</span></Link>}>
    <AsyncView loading={client.isLoading} error={client.error} empty={!client.data} onRetry={() => void client.refetch()}>
      {client.data && <>
        <section className="client-profile-card">
          <div className="client-profile-identity">
            <span className="client-profile-avatar">
              {client.data.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
            </span>
            <div><strong>{client.data.fullName}</strong><p>{actor.email}</p></div>
          </div>
          <Link className="client-profile-edit" to="/me/edit">Изменить данные <ChevronRightIcon /></Link>
        </section>
        {athleteSportProfile.supportsSportInterests && <section className="client-profile-card athlete-sport-card">
          <h2>Мой спорт</h2>
          <AsyncView loading={sport.isLoading} error={sport.error} onRetry={() => void sport.refetch()}>
            {sport.data && (sport.data.sports.length > 0 || sport.data.bio) ? <>
              {sport.data.sports.length > 0 && <>
                <div className="athlete-sport-options">{(showAllSports ? sport.data.sports : sport.data.sports.slice(0, 6)).map((id) => <span className="athlete-sport-tag" key={id}>{SPORT_INTEREST_LABELS[id] ?? id}</span>)}</div>
                {sport.data.sports.length > 6 && <button type="button" className="athlete-sport-more" aria-expanded={showAllSports} onClick={() => setShowAllSports((value) => !value)}>{showAllSports ? 'Свернуть' : `Показать ещё ${sport.data.sports.length - 6}`}</button>}
              </>}
              {sport.data.bio && <p className="athlete-sport-bio">{sport.data.bio}</p>}
            </> : <p>Расскажите, каким спортом занимаетесь. Это видно только вам.</p>}
          </AsyncView>
        </section>}
        <ClientTrainerConnections clientId={client.data.id} finance={<ClientFinanceHomeCard />} />
      </>}
    </AsyncView>
  </Page>
}

export function ClientProfileSettingsPage() {
  const { actor } = useAuth()
  const { clients: clientsRepository } = useDataBackend()
  const theme = useAppTheme()
  const limeTheme = useClientLimeTheme(actor?.userId ?? '')
  const showLiveExerciseAnimation = useLiveExerciseAnimation(actor?.userId)
  const useTimeWheel = useWorkoutTimeWheel()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const client = useQuery({
    queryKey: ['my-client'],
    queryFn: () => clientsRepository.getMine(),
    enabled: actor?.role === 'client',
  })
  if (!actor || actor.role !== 'client') return null

  return <Page title="Настройки" back="/me/profile" swipeBack className="client-profile-page client-settings-page settings-page">
    <SettingsSection title="Уведомления">
      <div className="profile-settings"><NotificationsSetting userId={actor.userId} role="client" /></div>
    </SettingsSection>

    <SettingsSection title="Тренировки">
      <div className="profile-settings">
        <Switch label="Анимация упражнения" checked={showLiveExerciseAnimation} onChange={(checked) => setLiveExerciseAnimation(actor.userId, checked)} />
        <Switch label="Ввод времени колёсиком" checked={useTimeWheel} onChange={setWorkoutTimeWheel} />
      </div>
    </SettingsSection>

    <SettingsSection title="Оформление">
      <div className="profile-settings">{isClientLimeEnabled(actor)
        ? <label className="field">Тема оформления<select value={limeTheme.preference} onChange={(event) => {
          const value = event.target.value
          if (value === 'light' || value === 'dark' || value === 'system') setClientLimeThemePreference(actor.userId, value)
        }}><option value="light">Светлая</option><option value="dark">Тёмная</option><option value="system">Как на устройстве</option></select></label>
        : <Switch label="Тёмная тема" checked={theme === 'dark'} onChange={(checked) => setAppTheme(checked ? 'dark' : 'light')} />}</div>
      {client.data && <BodyMapAppearanceSetting viewerUserId={actor.userId} role={actor.role} clientId={client.data.id} gender={client.data.gender} />}
    </SettingsSection>

    <SettingsSection title="Аккаунт и помощь">
      <AccountSettingsCard />
      <div className="menu">
        <button type="button" aria-expanded={installOpen} onClick={() => setInstallOpen((value) => !value)}>Fit на экране «Домой»</button>
        <button type="button" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen((value) => !value)}>Предложение или проблема</button>
        <a href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer">Поддержка в Telegram</a>
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
