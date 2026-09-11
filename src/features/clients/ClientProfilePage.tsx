import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { useOptionalYandexAppSession } from '../../app/yandex-app-session-context'
import { setAppTheme, useAppTheme } from '../../app/theme'
import { setLiveExerciseAnimation, useLiveExerciseAnimation } from '../../app/live-exercise-animation'
import { AsyncView, Page, Switch } from '../../shared/ui'
import { LogoutButton, YandexAccountLinkingCard } from '../auth'
import { ClientTrainerConnections } from './ClientTrainerConnections'
import { AppFeedbackForm } from '../profile/AppFeedbackForm'
import { useState } from 'react'
import { AppInstallPanel } from '../install'
import { NotificationsSetting } from '../notifications'
import { BodyMapAppearanceSetting } from '../progress/BodyMapAppearanceSetting'
import { LEGAL_PATHS } from '../../shared/legal'

export function ClientProfilePage() {
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

  return <Page title="Профиль" className="client-profile-page">
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
        <BodyMapAppearanceSetting
          viewerUserId={actor.userId}
          role={actor.role}
          clientId={client.data.id}
          gender={client.data.gender}
        />
      </>}
    </AsyncView>
    <section className="profile-settings" aria-label="Настройки">
      <Switch label="Тёмная тема" checked={theme === 'dark'} onChange={(checked) => setAppTheme(checked ? 'dark' : 'light')} />
      <div className="profile-settings-group-head"><strong>Live-тренировка</strong><span>Быстрая подсказка по движению у текущего упражнения.</span></div>
      <Switch label="Показывать анимацию текущего упражнения" checked={showLiveExerciseAnimation} onChange={(checked) => setLiveExerciseAnimation(actor.userId, checked)} />
      <NotificationsSetting userId={actor.userId} />
    </section>
    {yandexSession === null && <YandexAccountLinkingCard actor={actor} />}
    <div className="menu"><Link to="/join">Ввести код приглашения</Link><button type="button" aria-expanded={installOpen} onClick={() => setInstallOpen((value) => !value)}>Fit на экране «Домой»</button><button type="button" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen((value) => !value)}>Предложение или проблема</button><Link to={LEGAL_PATHS.terms}>Условия использования</Link><Link to={LEGAL_PATHS.privacy}>Политика конфиденциальности</Link><Link to={LEGAL_PATHS.deleteAccount}>Удаление аккаунта</Link></div>
    {installOpen && <AppInstallPanel onClose={() => setInstallOpen(false)} />}
    {feedbackOpen && <AppFeedbackForm onClose={() => setFeedbackOpen(false)} />}
    <LogoutButton />
  </Page>
}
