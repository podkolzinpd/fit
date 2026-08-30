import {
  addDays,
  addMonths,
  dayOfMonth,
  endOfMonth,
  localDate,
  startOfMonth,
  weekdayIndex,
  type LocalDate,
} from '../../shared/local-date'

export type ClientWorkoutHistoryView = 'list' | 'calendar'

export interface ClientWorkoutHistoryCalendarState {
  view: ClientWorkoutHistoryView
  month: LocalDate
  selectedDate?: LocalDate
}

export interface ClientWorkoutHistoryCalendarDay<T extends { workoutDate: LocalDate }> {
  date: LocalDate
  day: number
  inMonth: boolean
  future: boolean
  workouts: T[]
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/

function monthFromParam(value: string | null): LocalDate | null {
  if (!value || !MONTH_PATTERN.test(value)) return null
  try {
    return startOfMonth(localDate(`${value}-01`))
  } catch {
    return null
  }
}

function dateFromParam(value: string | null): LocalDate | null {
  if (!value) return null
  try {
    return localDate(value)
  } catch {
    return null
  }
}

export function clientWorkoutHistoryMonthParam(value: LocalDate): string {
  return startOfMonth(value).slice(0, 7)
}

export function parseClientWorkoutHistoryCalendarState(
  params: URLSearchParams,
  today: LocalDate,
): ClientWorkoutHistoryCalendarState {
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list'
  const currentMonth = startOfMonth(today)
  const requestedMonth = monthFromParam(params.get('month')) ?? currentMonth
  const month = requestedMonth > currentMonth ? currentMonth : requestedMonth
  const requestedDate = dateFromParam(params.get('date'))
  const selectedDate = requestedDate
    && startOfMonth(requestedDate) === month
    && requestedDate <= today
    ? requestedDate
    : undefined
  return { view, month, selectedDate }
}

export function clientWorkoutHistoryMonthRange(month: LocalDate, today: LocalDate): {
  from: LocalDate
  to: LocalDate
} {
  const currentMonth = startOfMonth(today)
  const from = startOfMonth(month) > currentMonth ? currentMonth : startOfMonth(month)
  const monthEnd = endOfMonth(from)
  return { from, to: monthEnd < today ? monthEnd : today }
}

export function shiftClientWorkoutHistoryMonth(
  month: LocalDate,
  direction: -1 | 1,
  today: LocalDate,
): LocalDate {
  const shifted = startOfMonth(addMonths(month, direction))
  const currentMonth = startOfMonth(today)
  return shifted > currentMonth ? currentMonth : shifted
}

function mondayGridStart(month: LocalDate): LocalDate {
  const weekday = weekdayIndex(month)
  return addDays(month, -(weekday === 0 ? 6 : weekday - 1))
}

export function clientWorkoutHistoryCalendarDays<T extends { workoutDate: LocalDate }>(
  month: LocalDate,
  today: LocalDate,
  workouts: readonly T[],
): ClientWorkoutHistoryCalendarDay<T>[] {
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(monthStart)
  const gridStart = mondayGridStart(monthStart)
  const byDate = new Map<LocalDate, T[]>()
  for (const workout of workouts) {
    const current = byDate.get(workout.workoutDate) ?? []
    current.push(workout)
    byDate.set(workout.workoutDate, current)
  }
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index)
    return {
      date,
      day: dayOfMonth(date),
      inMonth: date >= monthStart && date <= monthEnd,
      future: date > today,
      workouts: byDate.get(date) ?? [],
    }
  })
}
