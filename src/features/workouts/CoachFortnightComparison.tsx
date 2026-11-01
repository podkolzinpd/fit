import type { Workout } from '../../shared/domain'
import { addDays, dayOfMonth, formatLocalDate, formatWeekRange, weekdayShort, type LocalDate } from '../../shared/local-date'
import { BackIcon, CheckIcon, ChevronRightIcon, CloseIcon } from '../../shared/icons'
import { isIndependentScheduleWorkout } from './schedule-filters'
import { scheduleEventStatus } from './schedule-presentation'

export function CoachFortnightComparison({ weekStart, today, itemsByDay, onOpenDay, onShift }: {
  weekStart: LocalDate
  today: LocalDate
  itemsByDay: ReadonlyMap<LocalDate, Workout[]>
  onOpenDay: (date: LocalDate, periodStart: LocalDate) => void
  onShift: (direction: -1 | 1) => void
}) {
  return <section className="coach-fortnight-comparison" aria-label="Сравнение двух недель">
    <div className="coach-fortnight-headings">
      <span><button type="button" aria-label="Предыдущие 2 недели" onClick={() => onShift(-1)}><BackIcon /></button><span>{formatWeekRange(weekStart, addDays(weekStart, 6))}</span></span>
      <span><span>{formatWeekRange(addDays(weekStart, 7), addDays(weekStart, 13))}</span><button type="button" aria-label="Следующие 2 недели" onClick={() => onShift(1)}><ChevronRightIcon /></button></span>
    </div>
    <div className="coach-fortnight-days">
      {Array.from({ length: 7 }, (_, weekday) => [weekday, weekday + 7]).flat().map(offset => {
        const date = addDays(weekStart, offset), workouts = itemsByDay.get(date) ?? []
        return <button key={date} type="button" className={`coach-fortnight-day${date === today ? ' is-today' : ''}`} data-date={date}
          aria-label={`${formatLocalDate(date)}, ${workouts.length ? `занятий: ${workouts.length}` : 'нет тренировок'}`} onClick={() => onOpenDay(date, weekStart)}>
          <span className="coach-fortnight-day-heading"><span>{weekdayShort(date)}</span><strong>{dayOfMonth(date)}</strong></span>
          <span className="coach-fortnight-appointments">
            {workouts.map(workout => {
              const status = scheduleEventStatus(workout, today)
              return <span key={workout.id} className={`coach-fortnight-appointment schedule-event-${status.tone}`} title={`${workout.startTime?.slice(0, 5) ?? 'Без времени'} · ${workout.clientName} · ${status.label}`}>
                <time>{workout.startTime?.slice(0, 5) ?? '—'}</time><span className="coach-fortnight-client">{workout.clientName}</span>
                {workout.status === 'done' ? <CheckIcon /> : workout.status === 'cancelled' ? <CloseIcon /> : null}
                <span className="sr-only">{!workout.startTime && 'Без времени · '}{status.label}{isIndependentScheduleWorkout(workout) ? ' · Самостоятельно' : ''}</span>
              </span>
            })}
          </span>
        </button>
      })}
    </div>
  </section>
}
