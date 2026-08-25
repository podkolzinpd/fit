import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { setAppTheme, useAppTheme } from '../../app/theme'
import { authRepository } from '../../data/repositories/auth.repository'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { AsyncView, Page, Switch } from '../../shared/ui'
import { ClientTrainerConnections } from './ClientTrainerConnections'
import { AppFeedbackForm } from '../profile/AppFeedbackForm'
import { useState } from 'react'
import { AppInstallPanel } from '../install'
import { BodyMapAppearanceSetting } from '../progress/BodyMapAppearanceSetting'

export function ClientProfilePage() {
  const { actor } = useAuth()
  const navigate = useNavigate()
  const theme = useAppTheme()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const client = useQuery({
    queryKey: ['my-client'],
    queryFn: () => clientsRepository.getMine(),
    enabled: actor?.role === 'client',
  })
  if (!actor || actor.role !== 'client') return null

  async function logout() {
    await authRepository.signOut()
    navigate('/auth')
  }

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
        <BodyMapAppearanceSetting userId={actor.userId} role={actor.role} gender={client.data.gender} />
      </>}
    </AsyncView>
    <section className="profile-settings" aria-label="Настройки">
      <Switch label="Тёмная тема" checked={theme === 'dark'} onChange={(checked) => setAppTheme(checked ? 'dark' : 'light')} />
    </section>
    <div className="menu"><Link to="/join">Ввести код приглашения</Link><button type="button" aria-expanded={installOpen} onClick={() => setInstallOpen((value) => !value)}>Fit на экране «Домой»</button><button type="button" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen((value) => !value)}>Предложение или проблема</button></div>
    {installOpen && <AppInstallPanel onClose={() => setInstallOpen(false)} />}
    {feedbackOpen && <AppFeedbackForm onClose={() => setFeedbackOpen(false)} />}
    <button className="danger secondary wide" onClick={() => void logout()}>Выйти</button>
  </Page>
}
