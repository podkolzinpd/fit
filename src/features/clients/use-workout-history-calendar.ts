import { useSearchParams } from 'react-router-dom'
import type { LocalDate } from '../../shared/local-date'
import { clientWorkoutHistoryMonthParam, clientWorkoutHistoryMonthRange, parseClientWorkoutHistoryCalendarState, shiftClientWorkoutHistoryMonth } from './client-workout-history-calendar'

/** Calendar selections describe one history screen, not new Back steps. */
export function useWorkoutHistoryCalendar(today: LocalDate) {
  const [params, setParams] = useSearchParams()
  const state = parseClientWorkoutHistoryCalendarState(params, today)
  const range = clientWorkoutHistoryMonthRange(state.month, today)

  function showList() {
    const next = new URLSearchParams(params)
    for (const key of ['view', 'month', 'date']) next.delete(key)
    setParams(next, { replace: true })
  }

  function showCalendar(initialDate: LocalDate = today) {
    const next = new URLSearchParams(params)
    next.set('view', 'calendar')
    next.set('month', clientWorkoutHistoryMonthParam(initialDate))
    next.delete('date')
    setParams(next, { replace: true })
  }

  function shiftMonth(direction: -1 | 1) {
    showCalendar(shiftClientWorkoutHistoryMonth(state.month, direction, today))
  }

  function selectDate(date: LocalDate) {
    const next = new URLSearchParams(params)
    next.set('view', 'calendar')
    next.set('month', clientWorkoutHistoryMonthParam(state.month))
    next.set('date', date)
    setParams(next, { replace: true })
  }

  return { state, range, showList, showCalendar, shiftMonth, selectDate, search: params.size ? `?${params.toString()}` : '' }
}
