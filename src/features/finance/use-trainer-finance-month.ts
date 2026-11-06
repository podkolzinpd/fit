import { useQuery } from '@tanstack/react-query'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
import { addMonths, localDate, type LocalDate } from '../../shared/local-date'
import type { FinanceMetric } from './finance-monthly'

export function useTrainerFinanceMonth(today: LocalDate, lime: boolean) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const routeState: unknown = location.state
  const { trainerFinance } = useDataBackend()
  const raw = params.get('month')
  let month = localDate(`${today.slice(0,7)}-01`)
  let valid = false
  if (raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
    try { month = localDate(`${raw}-01`); valid = true } catch { /* Invalid route never enables monthly reporting. */ }
  }
  const enabled = lime && valid
  const metric: FinanceMetric = params.get('metric') === 'sessions' ? 'sessions' : 'money'
  const allHistory = params.get('history') === 'all'
  const query = useQuery({ queryKey: ['trainer-finance-overview', month.slice(0,7)],
    queryFn: () => trainerFinance.listOverview(month.slice(0,7)), enabled })
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key,value); else next.delete(key)
    setParams(next,{replace:true,state:routeState})
  }
  return { enabled, month, metric, allHistory, query,
    changeMetric: (value: FinanceMetric) => update('metric',value),
    changeHistory: (all: boolean) => update('history',all?'all':''),
    move: (offset: number) => update('month',addMonths(month,offset).slice(0,7)) }
}
