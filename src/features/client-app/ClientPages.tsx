import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { authRepository } from '../../data/repositories/auth.repository'
import { Page } from '../../shared/ui'
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
  if (!actor || actor.kind !== 'client') return null

  async function logout() {
    await authRepository.signOut()
    navigate('/auth')
  }

  return <Page title="Профиль">
    <section className="client-profile-card">
      <span className="client-profile-avatar">
        {actor.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
      </span>
      <div><strong>{actor.fullName}</strong><p>{actor.email}</p></div>
    </section>
    <p className="muted">Тренировочный профиль связан с твоим тренером. Изменения данных пока выполняются через тренера.</p>
    <button className="danger secondary wide" onClick={() => void logout()}>Выйти</button>
  </Page>
}
