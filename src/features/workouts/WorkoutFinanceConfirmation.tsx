import { Link } from 'react-router-dom'
import type { TrainerFinanceClientBundle } from '../../data/repositories/trainer-finance.repository'
import type { WorkoutTrainingFormat } from '../../shared/domain'

export function workoutFinanceConfirmation(bundle: TrainerFinanceClientBundle | undefined, workoutId: string, trainingFormat?: WorkoutTrainingFormat) {
  const session = bundle?.sessions.find((item) => item.workoutId === workoutId && item.voidedAt === null)
  if (!session) {
    if (trainingFormat === 'self') return { title: 'Самостоятельно', detail: 'Без списания' }
    if (trainingFormat === 'with_trainer' && bundle) return { title: 'Не списано', detail: 'Нет абонемента' }
    return null
  }
  const pack = session.packageId ? bundle?.packages.find((item) => item.id === session.packageId) : undefined
  if (session.disposition === 'charged' && pack) return { title: 'Занятие списано', detail: `${pack.title} · осталось ${pack.sessionsRemaining}` }
  if (session.disposition === 'unassigned') return { title: 'Нужно выбрать абонемент', detail: 'Занятие сохранено без списания' }
  if (session.disposition === 'trial') return { title: 'Пробное занятие', detail: 'Абонемент не списан' }
  return { title: 'Без списания', detail: 'Абонемент не списан' }
}

export function WorkoutFinanceConfirmation({ bundle, workoutId, clientId, trainingFormat }: { bundle?: TrainerFinanceClientBundle; workoutId: string; clientId: string; trainingFormat: WorkoutTrainingFormat }) {
  const result = workoutFinanceConfirmation(bundle, workoutId, trainingFormat)
  if (!result) return null
  return <section className="workout-finance-confirmation" aria-label="Учёт занятия">
    <div><strong>{result.title}</strong><span>{result.detail}</span></div>
    <Link to={`/clients/${clientId}/finance`}>Открыть финансы</Link>
  </section>
}
