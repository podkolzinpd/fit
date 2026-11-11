import { financeMoney } from '../finance/finance-monthly'
import { Link } from 'react-router-dom'
import type { TrainerFinanceClientBundle } from '../../data/contracts/trainer-finance'
import type { WorkoutTrainingFormat } from '../../shared/domain'
import { financePackagePeriod } from '../finance/finance-package-label'

export function workoutFinanceConfirmation(bundle: TrainerFinanceClientBundle | undefined, workoutId: string, trainingFormat?: WorkoutTrainingFormat, lime = false) {
  const session = bundle?.sessions.find((item) => item.workoutId === workoutId && item.voidedAt === null)
  if (!session) {
    if (trainingFormat === 'self') return { title: 'Самостоятельно', detail: 'Без списания' }
    if (trainingFormat === 'with_trainer' && bundle) return { title: 'Не списано', detail: 'Нет абонемента' }
    return null
  }
  const pack = session.packageId ? bundle?.packages.find((item) => item.id === session.packageId) : undefined
  if (lime && session.disposition === 'charged' && pack?.singleSession) return { title:'Разовое занятие проведено', detail:pack.priceCents===0?'Бесплатно':pack.dueCents>0?`К оплате ${financeMoney(pack.dueCents)}`:'Оплачено' }
  if (session.disposition === 'charged' && pack) return { title: 'Занятие списано', detail: `${pack.title} · ${financePackagePeriod(pack)} · осталось ${pack.sessionsRemaining}` }
  if (session.disposition === 'unassigned') return { title: 'Нужно выбрать абонемент', detail: 'Занятие сохранено без списания' }
  if (session.disposition === 'trial') return { title: 'Пробное занятие', detail: 'Абонемент не списан' }
  return { title: 'Без списания', detail: 'Абонемент не списан' }
}

export function WorkoutFinanceConfirmation({ bundle, workoutId, clientId, trainingFormat, lime = false }: { bundle?: TrainerFinanceClientBundle; workoutId: string; clientId: string; trainingFormat: WorkoutTrainingFormat; lime?: boolean }) {
  const result = workoutFinanceConfirmation(bundle, workoutId, trainingFormat, lime)
  if (!result) return null
  return <section className="workout-finance-confirmation" aria-label="Учёт занятия">
    <div><strong>{result.title}</strong><span>{result.detail}</span></div>
    <Link to={`/clients/${clientId}/finance`}>Открыть финансы</Link>
  </section>
}
