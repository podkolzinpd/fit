import { Link } from 'react-router-dom'
import type { Workout } from '../../shared/domain'
import { formatLocalDate, type LocalDate } from '../../shared/local-date'
import { workoutStatusPresentation } from '../../data/repositories/workout-rules'
import { isIndependentScheduleWorkout } from './schedule-filters'

export function FitLimeScheduleList({ workouts, today, returnTo, onOpenDay }: {
  workouts: Workout[]
  today: LocalDate
  returnTo: string
  onOpenDay: (date: LocalDate) => void
}) {
  const days = [...new Set(workouts.map((item) => item.workoutDate))].sort().reverse()
  if (!days.length) return <p className="state" role="status">По этим фильтрам тренировок нет.</p>
  return <section className="fit-lime-history" aria-label="Список тренировок">
    <p className="muted">Все даты · Найдено: {workouts.length}</p>
    {days.map((date) => {
      const items = workouts.filter((item) => item.workoutDate === date)
      const timed = items.filter((item) => item.startTime).sort((a, b) => a.startTime!.localeCompare(b.startTime!))
      const untimed = items.filter((item) => !item.startTime)
      const row = (item: Workout) => <Link key={item.id} className="fit-lime-history-row" to={`/workouts/${item.id}`} state={{ returnTo }}>
        <time>{item.startTime?.slice(0, 5) ?? '—'}</time>
        <span><strong>{item.clientName}</strong><small>{item.title || item.exercises.map((exercise) => exercise.name).slice(0, 2).join(', ') || 'Без упражнений'}</small><small>{isIndependentScheduleWorkout(item) && 'Самостоятельно · '}{item.status === 'done' ? `Проведена${workoutStatusPresentation(item, today).tone === 'partial' ? ' · план выполнен частично' : ''}` : item.status === 'cancelled' ? 'Отменена' : workoutStatusPresentation(item, today).label}</small></span>
      </Link>
      return <section key={date} aria-label={formatLocalDate(date)}>
        <h2><button type="button" className="link" onClick={() => onOpenDay(date)}>{formatLocalDate(date)}</button></h2>
        {timed.map(row)}
        {untimed.length > 0 && <div><h3>Без времени</h3>{untimed.map(row)}</div>}
      </section>
    })}
  </section>
}
