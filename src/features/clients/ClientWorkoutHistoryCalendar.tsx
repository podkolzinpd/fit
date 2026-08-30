import { useMemo } from 'react'
import type { Workout } from '../../shared/domain'
import { BackIcon, ChevronRightIcon } from '../../shared/icons'
import { formatLocalDate, formatMonth, startOfMonth, type LocalDate } from '../../shared/local-date'
import { WorkoutChronicleCard, workoutCountLabel } from '../workouts'
import { clientWorkoutHistoryCalendarDays } from './client-workout-history-calendar'

const WEEKDAY_LABELS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']

export function ClientWorkoutHistoryCalendar({
  month,
  today,
  workouts,
  selectedDate,
  loading,
  error,
  returnTo,
  contextLabel,
  onRetry,
  onMonthChange,
  onDateSelect,
}: {
  month: LocalDate
  today: LocalDate
  workouts: readonly Workout[]
  selectedDate?: LocalDate
  loading: boolean
  error?: Error | null
  returnTo: string
  contextLabel: (workout: Workout) => string | null
  onRetry: () => void
  onMonthChange: (direction: -1 | 1) => void
  onDateSelect: (date: LocalDate) => void
}) {
  const days = useMemo(
    () => clientWorkoutHistoryCalendarDays(month, today, workouts),
    [month, today, workouts],
  )
  const selectedWorkouts = selectedDate
    ? days.find((day) => day.date === selectedDate)?.workouts ?? []
    : []
  const currentMonth = startOfMonth(today)
  const monthLabel = formatMonth(month)

  return <div className="client-history-calendar" aria-busy={loading || undefined}>
    <div className="client-history-calendar-toolbar">
      <button type="button" className="client-history-calendar-arrow" aria-label="Предыдущий месяц" onClick={() => onMonthChange(-1)}><BackIcon /></button>
      <h3 aria-live="polite">{monthLabel}</h3>
      <button type="button" className="client-history-calendar-arrow" aria-label="Следующий месяц" disabled={month >= currentMonth} onClick={() => onMonthChange(1)}><ChevronRightIcon /></button>
    </div>
    <div className="client-history-calendar-grid" role="grid" aria-label={`История тренировок за ${monthLabel}`}>
      {WEEKDAY_LABELS.map((label) => <span className="client-history-calendar-weekday" role="columnheader" key={label}>{label}</span>)}
      {days.map((day) => {
        const selectable = day.inMonth && !day.future && day.workouts.length > 0
        const selected = selectable && day.date === selectedDate
        const todayDate = day.date === today
        const classes = [
          'client-history-calendar-day',
          day.inMonth ? '' : 'outside',
          day.future ? 'future' : '',
          selectable ? 'has-workout' : '',
          selected ? 'selected' : '',
          todayDate ? 'today' : '',
        ].filter(Boolean).join(' ')
        const content = <>
          <span className="client-history-calendar-day-number">{day.day}</span>
          {selectable && <span className="client-history-calendar-day-mark" aria-hidden="true">{day.workouts.length > 1 ? day.workouts.length : ''}</span>}
        </>
        return <span className={classes} role="gridcell" key={day.date}>
          {selectable
            ? <button
                type="button"
                aria-label={`${formatLocalDate(day.date)}, ${workoutCountLabel(day.workouts.length)}`}
                aria-pressed={selected}
                aria-current={todayDate ? 'date' : undefined}
                onClick={() => onDateSelect(day.date)}
              >{content}</button>
            : <span aria-hidden="true">{content}</span>}
        </span>
      })}
    </div>
    {loading && <p className="client-history-calendar-state" role="status">Загружаем месяц…</p>}
    {!loading && error && <div className="client-history-calendar-state" role="alert"><p>Не удалось загрузить историю за месяц.</p><button type="button" className="secondary" onClick={onRetry}>Повторить</button></div>}
    {!loading && !error && workouts.length === 0 && <p className="client-history-calendar-state">В этом месяце тренировок нет.</p>}
    {!loading && !error && selectedDate && selectedWorkouts.length > 0 && <section className="client-history-calendar-selection" aria-labelledby="client-history-calendar-selection-title">
      <div className="client-history-calendar-selection-head">
        <h4 id="client-history-calendar-selection-title">{formatLocalDate(selectedDate)}</h4>
        <span>{workoutCountLabel(selectedWorkouts.length)}</span>
      </div>
      <div className="cards client-workout-cards workout-chronicle-list">
        {selectedWorkouts.map((workout) => <WorkoutChronicleCard
          key={workout.id}
          workout={workout}
          contextLabel={contextLabel(workout)}
          returnTo={returnTo}
        />)}
      </div>
    </section>}
  </div>
}
