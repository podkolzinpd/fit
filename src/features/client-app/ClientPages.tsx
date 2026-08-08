import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { authRepository } from '../../data/repositories/auth.repository'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { AsyncView, Page } from '../../shared/ui'
import { ClientTrainingSummaryCard } from '../progress'

export function ClientProgressPage() {
  const { actor } = useAuth()
  if (!actor || actor.kind !== 'client') return null

  return <Page title="Мой прогресс" className="client-progress-page">
    <section className="client-welcome">
      <span>Привет, {actor.firstName ?? actor.fullName}</span>
      <h2>Посмотри, как меняются твои результаты</h2>
      <p>Запроси свежий анализ в любой момент — тренерская версия останется закрытой.</p>
    </section>
    <ClientTrainingSummaryCard clientId={actor.clientId} />
  </Page>
}

export function ClientProfilePage() {
  const { actor } = useAuth()
  const navigate = useNavigate()
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

  return <Page title="Профиль">
    <AsyncView loading={client.isLoading} error={client.error} empty={!client.data} onRetry={() => void client.refetch()}>
      {client.data && <>
        <section className="client-profile-card">
          <span className="client-profile-avatar">
            {client.data.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
          </span>
          <div><strong>{client.data.fullName}</strong><p>{actor.email}</p></div>
        </section>
        <Link className="button secondary wide" to="/me/edit">Изменить данные</Link>
      </>}
    </AsyncView>
    <button className="danger secondary wide" onClick={() => void logout()}>Выйти</button>
  </Page>
}
