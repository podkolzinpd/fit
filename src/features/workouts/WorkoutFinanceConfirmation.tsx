import { Link } from 'react-router-dom'
import type { TrainerFinanceClientBundle } from '../../data/repositories/trainer-finance.repository'

export function workoutFinanceConfirmation(bundle: TrainerFinanceClientBundle | undefined, workoutId: string) {
  const session = bundle?.sessions.find((item) => item.workoutId === workoutId && item.voidedAt === null)
  if (!session) return null
  const pack = session.packageId ? bundle?.packages.find((item) => item.id === session.packageId) : undefined
  if (session.disposition === 'charged' && pack) return { title: 'Занятие списано', detail: `${pack.title} · осталось ${pack.sessionsRemaining}` }
  if (session.disposition === 'unassigned') return { title: 'Нужно выбрать абонемент', detail: 'Занятие сохранено без списания' }
  if (session.disposition === 'trial') return { title: 'Пробное занятие', detail: 'Абонемент не списан' }
  return { title: 'Без списания', detail: 'Абонемент не списан' }
}

export function WorkoutFinanceConfirmation({ bundle, workoutId, clientId }: { bundle?: TrainerFinanceClientBundle; workoutId: string; clientId: string }) {
  const result = workoutFinanceConfirmation(bundle, workoutId)
  if (!result) return null
  return <section className="workout-finance-confirmation" aria-label="Учёт занятия">
    <div><strong>{result.title}</strong><span>{result.detail}</span></div>
    <Link to={`/clients/${clientId}/finance`}>Открыть финансы</Link>
  </section>
}
