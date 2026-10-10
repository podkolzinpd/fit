import { useSearchParams } from 'react-router-dom'
import type { LocalDate } from '../../shared/local-date'
import { clientWorkoutHistoryMonthParam, clientWorkoutHistoryMonthRange, parseClientWorkoutHistoryCalendarState, shiftClientWorkoutHistoryMonth } from './client-workout-history-calendar'

type CalendarScope = 'history' | 'planned'

/** Separate URL keys keep each tab's view/month/day while filters add no Back steps. */
function useWorkoutCalendar(today: LocalDate, scope: CalendarScope) {
  const [params, setParams] = useSearchParams()
  const keys = scope === 'history'
    ? { view: 'view', month: 'month', date: 'date' }
    : { view: 'plannedView', month: 'plannedMonth', date: 'plannedDate' }
  const allowFuture = scope === 'planned'
  const scopedParams = new URLSearchParams()
  for (const key of ['view', 'month', 'date'] as const) {
    const value = params.get(keys[key])
    if (value !== null) scopedParams.set(key, value)
  }
  const state = parseClientWorkoutHistoryCalendarState(scopedParams, today, allowFuture)
  const range = clientWorkoutHistoryMonthRange(state.month, today, allowFuture)

  function showList() {
    const next = new URLSearchParams(params)
    for (const key of Object.values(keys)) next.delete(key)
    setParams(next, { replace: true })
  }

  function showCalendar(initialDate: LocalDate = today) {
    const next = new URLSearchParams(params)
    next.set(keys.view, 'calendar')
    next.set(keys.month, clientWorkoutHistoryMonthParam(initialDate))
    next.delete(keys.date)
    setParams(next, { replace: true })
  }

  function shiftMonth(direction: -1 | 1) {
    showCalendar(shiftClientWorkoutHistoryMonth(state.month, direction, today, allowFuture))
  }

  function selectDate(date: LocalDate) {
    const next = new URLSearchParams(params)
    next.set(keys.view, 'calendar')
    next.set(keys.month, clientWorkoutHistoryMonthParam(state.month))
    next.set(keys.date, date)
    setParams(next, { replace: true })
  }

  return { state, range, showList, showCalendar, shiftMonth, selectDate, search: params.size ? `?${params.toString()}` : '' }
}

export function useWorkoutHistoryCalendar(today: LocalDate) {
  return useWorkoutCalendar(today, 'history')
}

export function useWorkoutPlannedCalendar(today: LocalDate) {
  return useWorkoutCalendar(today, 'planned')
}
