import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { useOptionalYandexAppSession } from '../../app/yandex-app-session-context'
import { setAppTheme, useAppTheme } from '../../app/theme'
import { setLiveExerciseAnimation, useLiveExerciseAnimation } from '../../app/live-exercise-animation'
import { SettingsIcon } from '../../shared/icons'
import { LEGAL_PATHS } from '../../shared/legal'
import { AsyncView, Page, Switch } from '../../shared/ui'
import { LogoutButton, YandexAccountLinkingCard } from '../auth'
import { AppInstallPanel } from '../install'
import { NotificationsSetting } from '../notifications'
import { AppFeedbackForm } from '../profile/AppFeedbackForm'
import { AccountSettingsCard, SettingsSection } from '../profile/SettingsSection'
import { BodyMapAppearanceSetting } from '../progress/BodyMapAppearanceSetting'
import { ClientTrainerConnections } from './ClientTrainerConnections'

export function ClientProfilePage() {
  const { actor } = useAuth()
  const { clients: clientsRepository } = useDataBackend()
  const client = useQuery({
    queryKey: ['my-client'],
    queryFn: () => clientsRepository.getMine(),
    enabled: actor?.role === 'client',
  })
  if (!actor || actor.role !== 'client') return null

  return <Page title="Профиль" className="client-profile-page" action={<Link className="profile-settings-link" to="/me/settings" aria-label="Настройки профиля"><SettingsIcon /></Link>}>
    <AsyncView loading={client.isLoading} error={client.error} empty={!client.data} onRetry={() => void client.refetch()}>
      {client.data && <>
        <section className="client-profile-card">
          <div className="client-profile-identity">
            <span className="client-profile-avatar">
              {client.data.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
            </span>
            <div><strong>{client.data.fullName}</strong><p>{actor.email}</p></div>
          </div>
          <Link className="button secondary client-profile-edit" to="/me/edit">Изменить данные</Link>
        </section>
        <ClientTrainerConnections clientId={client.data.id} />
      </>}
    </AsyncView>
  </Page>
}

export function ClientProfileSettingsPage() {
  const { actor } = useAuth()
  const { clients: clientsRepository } = useDataBackend()
  const yandexSession = useOptionalYandexAppSession()?.session ?? null
  const theme = useAppTheme()
  const showLiveExerciseAnimation = useLiveExerciseAnimation(actor?.userId)
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
      <div className="profile-settings"><Switch label="Анимация упражнения" checked={showLiveExerciseAnimation} onChange={(checked) => setLiveExerciseAnimation(actor.userId, checked)} /></div>
    </SettingsSection>

    <SettingsSection title="Оформление">
      <div className="profile-settings"><Switch label="Тёмная тема" checked={theme === 'dark'} onChange={(checked) => setAppTheme(checked ? 'dark' : 'light')} /></div>
      {client.data && <BodyMapAppearanceSetting viewerUserId={actor.userId} role={actor.role} clientId={client.data.id} gender={client.data.gender} />}
    </SettingsSection>

    <SettingsSection title="Аккаунт и помощь">
      <AccountSettingsCard />
      {yandexSession === null && <YandexAccountLinkingCard actor={actor} />}
      <div className="menu">
        <Link to="/join">Ввести код приглашения</Link>
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
